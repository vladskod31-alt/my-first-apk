# frozen_string_literal: true

require 'digest'
require 'fileutils'
require 'json'
require 'net/http'
require 'nokogiri'
require 'openssl'
require 'optparse'
require 'rss'
require 'rexml/document'
require 'set'
require 'socket'
require 'time'
require 'uri'

module DbaMaterialsScanner
  VERSION = '1.0.0'
  USER_AGENT = "DbaMaterialsScanner/#{VERSION} (+https://github.com/vladskod31-alt/my-first-apk)"

  class Error < StandardError; end

  Entry = Struct.new(:id, :title, :url, :published_at, keyword_init: true)
  HttpResponse = Struct.new(:body, :content_type, :url, :status, keyword_init: true)

  # Small standard-library HTTP client with bounded response size and redirects.
  class HttpClient
    MAX_BODY_BYTES = 2 * 1024 * 1024
    MAX_REDIRECTS = 3
    REDIRECT_CODES = [301, 302, 303, 307, 308].freeze

    def initialize(timeout: 20)
      @timeout = Integer(timeout)
      raise Error, 'HTTP timeout must be positive' unless @timeout.positive?
    rescue ArgumentError, TypeError
      raise Error, 'HTTP timeout must be a positive integer'
    end

    def get(url)
      request(:get, url)
    end

    def post_json(url, payload)
      request(
        :post,
        url,
        body: JSON.generate(payload),
        headers: { 'Content-Type' => 'application/json', 'Accept' => 'application/json' }
      )
    end

    private

    def request(method, raw_url, body: nil, headers: {})
      current_url = raw_url.to_s
      redirects = 0

      loop do
        uri = validate_url!(current_url)
        request = method == :get ? Net::HTTP::Get.new(uri.request_uri) : Net::HTTP::Post.new(uri.request_uri)
        request['User-Agent'] = USER_AGENT
        request['Accept'] = 'application/rss+xml, application/atom+xml, application/feed+json, text/html, */*'
        headers.each { |name, value| request[name] = value }
        request.body = body if body

        response = Net::HTTP.start(
          uri.host,
          uri.port,
          use_ssl: uri.scheme == 'https',
          open_timeout: @timeout,
          read_timeout: @timeout
        ) { |http| http.request(request) }

        status = response.code.to_i
        if REDIRECT_CODES.include?(status)
          location = response['location']
          raise Error, "HTTP #{status} response did not include a Location header" if location.to_s.empty?
          raise Error, 'Webhook redirects are not followed' if method == :post
          raise Error, "Too many redirects (maximum #{MAX_REDIRECTS})" if redirects >= MAX_REDIRECTS

          current_url = URI.join(uri.to_s, location).to_s
          redirects += 1
          next
        end

        unless status.between?(200, 299)
          raise Error, "HTTP request to #{uri.host} failed with status #{status}"
        end

        response_body = response.body.to_s
        if response_body.bytesize > MAX_BODY_BYTES
          raise Error, "Response is larger than #{MAX_BODY_BYTES} bytes"
        end

        return HttpResponse.new(
          body: response_body,
          content_type: response['content-type'].to_s,
          url: uri.to_s,
          status: status
        )
      end
    rescue URI::InvalidURIError => e
      raise Error, "Invalid URL: #{e.message}"
    rescue Net::OpenTimeout, Net::ReadTimeout, SocketError, SystemCallError, OpenSSL::SSL::SSLError => e
      raise Error, "HTTP request failed: #{e.class}: #{e.message}"
    end

    def validate_url!(raw_url)
      uri = URI.parse(raw_url)
      unless %w[http https].include?(uri.scheme) && !uri.host.to_s.empty? && uri.userinfo.nil?
        raise Error, 'Source and notification URLs must be absolute HTTP(S) URLs without embedded credentials'
      end

      uri
    end
  end

  # Parses RSS/Atom/JSON Feed or a public HTML listing page.
  class Parser
    FEED_MARKER = /<(?:[a-z][\w.-]*:)?(?:rss|feed|RDF)(?:\s|>)/i
    DEFAULT_SELECTORS = {
      item: 'article',
      title: 'h1, h2, h3, h4',
      link: 'a[href]',
      date: 'time[datetime], [datetime]'
    }.freeze

    def initialize(mode: 'auto', selectors: {})
      @mode = mode.to_s.downcase
      raise Error, 'Mode must be auto, feed, or html' unless %w[auto feed html].include?(@mode)

      @selectors = DEFAULT_SELECTORS.merge(selectors.transform_keys(&:to_sym))
    end

    def parse(response)
      mode = resolved_mode(response)
      entries = mode == 'feed' ? parse_feed(response) : parse_html(response)
      entries.uniq(&:id)
    rescue RSS::Error, REXML::ParseException => e
      raise Error, "Could not parse RSS/Atom feed: #{e.message}"
    rescue JSON::ParserError => e
      raise Error, "Could not parse JSON Feed: #{e.message}"
    rescue Nokogiri::CSS::SyntaxError => e
      raise Error, "Invalid CSS selector: #{e.message}"
    end

    private

    def resolved_mode(response)
      return @mode unless @mode == 'auto'

      content_type = response.content_type.to_s.downcase
      body = response.body.to_s
      if content_type.match?(/rss|atom|json/) || body.match?(FEED_MARKER) || body.lstrip.start_with?('{')
        'feed'
      else
        'html'
      end
    end

    def parse_feed(response)
      if response.content_type.to_s.downcase.include?('json') || response.body.to_s.lstrip.start_with?('{')
        return parse_json_feed(response)
      end

      feed = RSS::Parser.parse(response.body, false)
      raise Error, 'The URL did not return a readable RSS or Atom feed' if feed.nil?

      items = feed.respond_to?(:items) ? Array(feed.items) : []
      items = Array(feed.entries) if items.empty? && feed.respond_to?(:entries)
      if items.empty? && feed.respond_to?(:channel) && feed.channel
        items = Array(feed.channel.items)
      end

      items.filter_map { |item| feed_entry(item, response.url) }
    end

    def parse_json_feed(response)
      feed = JSON.parse(response.body)
      items = feed.is_a?(Hash) ? feed['items'] : nil
      raise Error, 'The URL did not return a valid JSON Feed with an items array' unless items.is_a?(Array)

      items.filter_map do |item|
        next unless item.is_a?(Hash)

        title = clean_text(item['title'] || item['content_text'] || item['content_html'])
        url = absolute_http_url(item['url'] || item['external_url'], response.url)
        next if title.empty? || url.nil?

        published = item['date_published'] || item['date_modified']
        Entry.new(
          id: stable_id(item['id'], title, url, published),
          title: title,
          url: url,
          published_at: normalize_time(published)
        )
      end
    end

    def feed_entry(item, base_url)
      title_object = item.respond_to?(:title) ? item.title : nil
      title = clean_text(value_of(title_object))
      raw_url = feed_link(item)
      url = absolute_http_url(raw_url, base_url)
      return if title.empty? || url.nil?

      raw_id = %i[id guid].filter_map do |method_name|
        next unless item.respond_to?(method_name)

        value_of(item.public_send(method_name))
      end.find { |value| !value.to_s.strip.empty? }

      published = %i[published pubDate updated date].filter_map do |method_name|
        next unless item.respond_to?(method_name)

        value_of(item.public_send(method_name))
      end.find { |value| !value.to_s.strip.empty? }

      Entry.new(
        id: stable_id(raw_id, title, url, published),
        title: title,
        url: url,
        published_at: normalize_time(published)
      )
    end

    def feed_link(item)
      if item.respond_to?(:links)
        links = Array(item.links)
        selected = links.find { |link| link.respond_to?(:rel) && link.rel.to_s == 'alternate' } || links.first
        href = selected.href if selected&.respond_to?(:href)
        return href unless href.to_s.strip.empty?
      end

      return unless item.respond_to?(:link)

      link = item.link
      link.respond_to?(:href) ? link.href : value_of(link)
    end

    def parse_html(response)
      doc = Nokogiri::HTML(response.body, response.url)
      doc.css(@selectors.fetch(:item)).filter_map do |node|
        anchor = node.at_css(@selectors.fetch(:link))
        anchor ||= node if node.name == 'a' && node['href']
        heading = node.at_css(@selectors.fetch(:title))
        title = clean_text(heading&.text)
        title = clean_text(anchor&.text) if title.empty?
        url = absolute_http_url(anchor&.[]('href'), response.url)
        next if title.empty? || url.nil?

        date_node = node.at_css(@selectors.fetch(:date))
        date_value = date_node&.[]('datetime') || date_node&.text
        Entry.new(
          id: stable_id(nil, title, url, date_value),
          title: title,
          url: url,
          published_at: normalize_time(date_value)
        )
      end
    end

    def value_of(value)
      return if value.nil?
      return value if value.is_a?(String) || value.is_a?(Numeric)
      return value.content if value.respond_to?(:content)

      value.to_s
    end

    def clean_text(value)
      Nokogiri::HTML.fragment(value.to_s).text.gsub(/[[:space:]]+/, ' ').strip
    end

    def absolute_http_url(raw_url, base_url)
      return if raw_url.to_s.strip.empty?

      uri = URI.join(base_url, raw_url.to_s.strip)
      return unless %w[http https].include?(uri.scheme) && !uri.host.to_s.empty?

      uri.fragment = nil
      uri.to_s
    rescue URI::InvalidURIError
      nil
    end

    def normalize_time(value)
      return if value.to_s.strip.empty?

      Time.parse(value.to_s).utc.iso8601
    rescue ArgumentError, TypeError
      nil
    end

    def stable_id(raw_id, title, url, published)
      candidate = raw_id.to_s.strip
      return candidate unless candidate.empty?

      Digest::SHA256.hexdigest([title, url, published].join("\n"))
    end
  end

  class StateStore
    MAX_SEEN_IDS = 5_000

    def initialize(path)
      @path = path.to_s
      raise Error, 'State file path cannot be empty' if @path.strip.empty?
    end

    # Returns nil when no baseline has been created yet.
    def load
      return nil unless File.file?(@path)

      data = JSON.parse(File.read(@path))
      unless data.is_a?(Hash) && data['version'] == 1 && data['seen_ids'].is_a?(Array) && data['seen_ids'].all? { |id| id.is_a?(String) }
        raise Error, "State file #{@path} has an unsupported format"
      end

      data['seen_ids'].uniq.last(MAX_SEEN_IDS)
    rescue JSON::ParserError => e
      raise Error, "Cannot read state file #{@path}: #{e.message}"
    rescue SystemCallError => e
      raise Error, "Cannot access state file #{@path}: #{e.message}"
    end

    def save(ids)
      directory = File.dirname(File.expand_path(@path))
      FileUtils.mkdir_p(directory)
      safe_ids = Array(ids).map(&:to_s).reject(&:empty?).uniq.last(MAX_SEEN_IDS)
      contents = JSON.pretty_generate({ version: 1, seen_ids: safe_ids }) + "\n"
      temporary_path = "#{@path}.tmp.#{$$}.#{rand(1_000_000)}"

      File.open(temporary_path, 'w', 0o600) do |file|
        file.write(contents)
        file.flush
        file.fsync
      end
      File.rename(temporary_path, @path)
      safe_ids
    rescue SystemCallError => e
      raise Error, "Cannot save state file #{@path}: #{e.message}"
    ensure
      FileUtils.rm_f(temporary_path) if defined?(temporary_path) && temporary_path && File.exist?(temporary_path)
    end
  end

  class Notifier
    def initialize(http_client:, webhook_url: nil, telegram_bot_token: nil, telegram_chat_id: nil, output: $stdout)
      if telegram_bot_token.to_s.empty? != telegram_chat_id.to_s.empty?
        raise Error, 'Set both DBA_TELEGRAM_BOT_TOKEN and DBA_TELEGRAM_CHAT_ID, or leave both unset'
      end

      @http_client = http_client
      @webhook_url = webhook_url.to_s.strip
      @telegram_bot_token = telegram_bot_token.to_s.strip
      @telegram_chat_id = telegram_chat_id.to_s.strip
      @output = output
    end

    def notify(entry, source_url:)
      message = "New DBA material: #{entry.title}\n#{entry.url}"

      unless @webhook_url.empty?
        @http_client.post_json(
          @webhook_url,
          {
            event: 'new_material',
            source_url: source_url,
            title: entry.title,
            url: entry.url,
            published_at: entry.published_at
          }
        )
      end

      unless @telegram_bot_token.empty?
        telegram_response = @http_client.post_json(
          "https://api.telegram.org/bot#{@telegram_bot_token}/sendMessage",
          {
            chat_id: @telegram_chat_id,
            text: message,
            disable_web_page_preview: false
          }
        )
        telegram_result = JSON.parse(telegram_response.body)
        raise Error, 'Telegram rejected the notification' unless telegram_result['ok'] == true
      end

      @output.puts("[new material] #{entry.title}\n#{entry.url}")
      @output.flush
    rescue JSON::ParserError => e
      raise Error, "Telegram returned invalid JSON: #{e.message}"
    end
  end

  class Scanner
    def initialize(source_url:, state_store:, notifier:, http_client: HttpClient.new, mode: 'auto',
                   notify_existing: false, selectors: {}, output: $stdout)
      @source_url = source_url.to_s.strip
      raise Error, 'A source URL is required' if @source_url.empty?

      @state_store = state_store
      @notifier = notifier
      @http_client = http_client
      @parser = Parser.new(mode: mode, selectors: selectors)
      @notify_existing = notify_existing
      @output = output
    end

    # Returns the number of successfully delivered new entries.
    def scan
      response = @http_client.get(@source_url)
      entries = @parser.parse(response)
      previous_ids = @state_store.load

      if previous_ids.nil? && !@notify_existing
        @state_store.save(entries.map(&:id))
        @output.puts("Baseline saved: #{entries.length} existing material(s); no notifications sent.")
        return 0
      end

      @state_store.save([]) if previous_ids.nil?
      seen = Set.new(previous_ids || [])
      fresh_entries = entries.reject { |entry| seen.include?(entry.id) }
      delivered = 0

      # Feed pages are usually newest-first; deliver older unseen items first.
      fresh_entries.reverse_each do |entry|
        @notifier.notify(entry, source_url: response.url)
        seen.add(entry.id)
        @state_store.save(seen.to_a)
        delivered += 1
      end

      @output.puts('No new materials found.') if fresh_entries.empty?
      delivered
    end
  end

  class CLI
    def initialize(argv, env: ENV, output: $stdout, error_output: $stderr)
      @argv = argv.dup
      @env = env
      @output = output
      @error_output = error_output
    end

    def run
      options = defaults
      parser = option_parser(options)
      parser.parse!(@argv)
      if options[:help]
        @output.puts(parser)
        return 0
      end
      if options[:version]
        @output.puts(VERSION)
        return 0
      end
      raise Error, "Unexpected arguments: #{@argv.join(' ')}" unless @argv.empty?
      raise Error, 'Set DBA_SOURCE_URL or pass --source URL' if options[:source_url].to_s.strip.empty?
      raise Error, 'HTTP timeout must be a positive integer' unless options[:timeout].positive?
      raise Error, 'Interval must be zero (one shot) or a positive integer' if options[:interval].negative?

      http_client = HttpClient.new(timeout: options[:timeout])
      notifier = Notifier.new(
        http_client: http_client,
        webhook_url: options[:webhook_url],
        telegram_bot_token: options[:telegram_bot_token],
        telegram_chat_id: options[:telegram_chat_id],
        output: @output
      )
      scanner = Scanner.new(
        source_url: options[:source_url],
        state_store: StateStore.new(options[:state_file]),
        notifier: notifier,
        http_client: http_client,
        mode: options[:mode],
        notify_existing: options[:notify_existing],
        selectors: options[:selectors],
        output: @output
      )

      loop do
        begin
          scanner.scan
        rescue Error => e
          @error_output.puts("Scan failed: #{e.message}")
          return 1 if options[:interval].zero?
        end
        break if options[:interval].zero?

        sleep(options[:interval])
      end
      0
    rescue OptionParser::ParseError, Error, ArgumentError => e
      @error_output.puts("Error: #{e.message}")
      @error_output.puts('Run `bin/dba-scanner --help` for usage.')
      2
    end

    private

    def defaults
      {
        source_url: @env['DBA_SOURCE_URL'],
        mode: @env.fetch('DBA_MODE', 'auto'),
        state_file: @env.fetch('DBA_STATE_FILE', 'data/seen.json'),
        interval: integer_env('DBA_INTERVAL_SECONDS', 0),
        timeout: integer_env('DBA_HTTP_TIMEOUT', 20),
        webhook_url: @env['DBA_NOTIFY_WEBHOOK_URL'],
        telegram_bot_token: @env['DBA_TELEGRAM_BOT_TOKEN'],
        telegram_chat_id: @env['DBA_TELEGRAM_CHAT_ID'],
        notify_existing: truthy?(@env['DBA_NOTIFY_EXISTING']),
        selectors: {
          item: @env.fetch('DBA_ITEM_SELECTOR', Parser::DEFAULT_SELECTORS[:item]),
          title: @env.fetch('DBA_TITLE_SELECTOR', Parser::DEFAULT_SELECTORS[:title]),
          link: @env.fetch('DBA_LINK_SELECTOR', Parser::DEFAULT_SELECTORS[:link]),
          date: @env.fetch('DBA_DATE_SELECTOR', Parser::DEFAULT_SELECTORS[:date])
        },
        help: false,
        version: false
      }
    end

    def option_parser(options)
      OptionParser.new do |parser|
        parser.banner = 'Usage: bin/dba-scanner [options]'
        parser.separator ''
        parser.separator 'Scan RSS/Atom/JSON Feed or a public HTML page for new materials.'
        parser.separator ''
        parser.on('--source URL', 'Source URL (or set DBA_SOURCE_URL)') { |value| options[:source_url] = value }
        parser.on('--mode MODE', %w[auto feed html], 'Parser mode: auto, feed, or html') { |value| options[:mode] = value }
        parser.on('--state PATH', 'Seen-items state file (default: data/seen.json)') { |value| options[:state_file] = value }
        parser.on('--interval SECONDS', Integer, 'Poll repeatedly; 0 means one scan') { |value| options[:interval] = value }
        parser.on('--timeout SECONDS', Integer, 'HTTP timeout (default: 20)') { |value| options[:timeout] = value }
        parser.on('--webhook URL', 'Optional JSON webhook URL') { |value| options[:webhook_url] = value }
        parser.on('--telegram-bot-token TOKEN', 'Telegram bot token (prefer DBA_TELEGRAM_BOT_TOKEN)') { |value| options[:telegram_bot_token] = value }
        parser.on('--telegram-chat-id ID', 'Telegram chat ID (prefer DBA_TELEGRAM_CHAT_ID)') { |value| options[:telegram_chat_id] = value }
        parser.on('--notify-existing', 'Send every current entry on the first scan') { options[:notify_existing] = true }
        parser.on('--item-selector CSS', 'HTML item selector (default: article)') { |value| options[:selectors][:item] = value }
        parser.on('--title-selector CSS', 'HTML title selector') { |value| options[:selectors][:title] = value }
        parser.on('--link-selector CSS', 'HTML link selector') { |value| options[:selectors][:link] = value }
        parser.on('--date-selector CSS', 'HTML date selector') { |value| options[:selectors][:date] = value }
        parser.on('-h', '--help', 'Show this help') { options[:help] = true }
        parser.on('--version', 'Show version') { options[:version] = true }
      end
    end

    def integer_env(name, fallback)
      Integer(@env.fetch(name, fallback.to_s), 10)
    rescue ArgumentError
      raise Error, "#{name} must be an integer"
    end

    def truthy?(value)
      %w[1 true yes on].include?(value.to_s.downcase)
    end
  end
end
