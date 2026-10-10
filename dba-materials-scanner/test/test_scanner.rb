# frozen_string_literal: true

require 'minitest/autorun'
require 'stringio'
require 'tmpdir'
require_relative '../lib/dba_materials_scanner'

class ScannerTest < Minitest::Test
  class FakeHttpClient
    attr_accessor :response

    def initialize(response)
      @response = response
    end

    def get(_url)
      response
    end
  end

  class FakeNotifier
    attr_reader :delivered

    def initialize
      @delivered = []
    end

    def notify(entry, source_url:)
      delivered << [entry, source_url]
    end
  end

  def test_first_scan_seeds_state_then_only_notifies_new_items
    Dir.mktmpdir('dba-scanner-test') do |directory|
      state = DbaMaterialsScanner::StateStore.new(File.join(directory, 'seen.json'))
      http = FakeHttpClient.new(response(feed_xml(['Existing'])) )
      notifier = FakeNotifier.new
      output = StringIO.new
      scanner = build_scanner(state:, http:, notifier:, output:)

      assert_equal 0, scanner.scan
      assert_empty notifier.delivered
      assert_includes output.string, 'Baseline saved'

      http.response = response(feed_xml(%w[New Existing]))
      assert_equal 1, scanner.scan
      assert_equal ['New'], notifier.delivered.map { |entry, _url| entry.title }
      assert_equal 'https://example.test/feed.xml', notifier.delivered.first.last

      assert_equal 0, scanner.scan
      assert_equal 1, notifier.delivered.length
    end
  end

  def test_can_notify_existing_entries_on_first_scan
    Dir.mktmpdir('dba-scanner-test') do |directory|
      state = DbaMaterialsScanner::StateStore.new(File.join(directory, 'seen.json'))
      http = FakeHttpClient.new(response(feed_xml(['Existing'])) )
      notifier = FakeNotifier.new
      scanner = build_scanner(state:, http:, notifier:, notify_existing: true)

      assert_equal 1, scanner.scan
      assert_equal ['Existing'], notifier.delivered.map { |entry, _url| entry.title }
    end
  end

  private

  def build_scanner(state:, http:, notifier:, output: StringIO.new, notify_existing: false)
    DbaMaterialsScanner::Scanner.new(
      source_url: 'https://example.test/feed.xml',
      state_store: state,
      notifier: notifier,
      http_client: http,
      mode: 'feed',
      notify_existing: notify_existing,
      output: output
    )
  end

  def response(body)
    DbaMaterialsScanner::HttpResponse.new(
      body: body,
      content_type: 'application/rss+xml',
      url: 'https://example.test/feed.xml',
      status: 200
    )
  end

  def feed_xml(titles)
    items = titles.map do |title|
      "<item><title>#{title}</title><link>https://example.test/#{title.downcase}</link><guid>#{title.downcase}</guid></item>"
    end.join
    "<rss version=\"2.0\"><channel><title>DBA</title>#{items}</channel></rss>"
  end
end
