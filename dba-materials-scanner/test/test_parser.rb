# frozen_string_literal: true

require 'minitest/autorun'
require_relative '../lib/dba_materials_scanner'

class ParserTest < Minitest::Test
  def test_parses_rss_entries_and_relative_links
    response = DbaMaterialsScanner::HttpResponse.new(
      body: <<~XML,
        <?xml version="1.0"?>
        <rss version="2.0">
          <channel>
            <title>DBA materials</title>
            <item>
              <title>  New   guide  </title>
              <link>/materials/guide</link>
              <guid>guide-1</guid>
              <pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate>
            </item>
          </channel>
        </rss>
      XML
      content_type: 'application/rss+xml',
      url: 'https://example.test/feed.xml',
      status: 200
    )

    entries = DbaMaterialsScanner::Parser.new(mode: 'feed').parse(response)

    assert_equal 1, entries.length
    assert_equal 'New guide', entries.first.title
    assert_equal 'https://example.test/materials/guide', entries.first.url
    assert_equal 'guide-1', entries.first.id
    assert_equal '2026-10-05T10:00:00Z', entries.first.published_at
  end

  def test_parses_html_with_configured_selectors
    response = DbaMaterialsScanner::HttpResponse.new(
      body: '<main><article><h2>New document</h2><a href="/docs/42">Read</a><time datetime="2026-10-09"></time></article></main>',
      content_type: 'text/html; charset=utf-8',
      url: 'https://example.test/materials',
      status: 200
    )
    parser = DbaMaterialsScanner::Parser.new(
      mode: 'html',
      selectors: { item: 'article', title: 'h2', link: 'a[href]', date: 'time[datetime]' }
    )

    entry = parser.parse(response).first

    assert_equal 'New document', entry.title
    assert_equal 'https://example.test/docs/42', entry.url
    assert_equal '2026-10-09T00:00:00Z', entry.published_at
  end

  def test_auto_mode_detects_json_feed
    response = DbaMaterialsScanner::HttpResponse.new(
      body: '{"version":"https://jsonfeed.org/version/1.1","items":[{"id":"doc-1","title":"JSON item","url":"https://example.test/json-item"}]}',
      content_type: 'application/feed+json',
      url: 'https://example.test/feed.json',
      status: 200
    )

    entries = DbaMaterialsScanner::Parser.new.parse(response)

    assert_equal ['JSON item'], entries.map(&:title)
    assert_equal 'doc-1', entries.first.id
  end

  def test_auto_mode_detects_atom
    response = DbaMaterialsScanner::HttpResponse.new(
      body: <<~XML,
        <?xml version="1.0"?>
        <feed xmlns="http://www.w3.org/2005/Atom">
          <title>DBA</title>
          <entry>
            <id>tag:example.test,2026:abc</id>
            <title>Atom item</title>
            <link href="https://example.test/atom-item" rel="alternate" />
          </entry>
        </feed>
      XML
      content_type: 'application/atom+xml',
      url: 'https://example.test/atom.xml',
      status: 200
    )

    entries = DbaMaterialsScanner::Parser.new.parse(response)

    assert_equal ['Atom item'], entries.map(&:title)
    assert_equal 'tag:example.test,2026:abc', entries.first.id
  end
end
