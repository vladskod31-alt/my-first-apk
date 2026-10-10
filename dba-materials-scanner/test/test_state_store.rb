# frozen_string_literal: true

require 'minitest/autorun'
require 'tmpdir'
require_relative '../lib/dba_materials_scanner'

class StateStoreTest < Minitest::Test
  def test_saves_and_loads_unique_ids
    Dir.mktmpdir('dba-scanner-state') do |directory|
      store = DbaMaterialsScanner::StateStore.new(File.join(directory, 'nested', 'seen.json'))

      assert_nil store.load
      store.save(%w[one two one])
      assert_equal %w[one two], store.load
    end
  end

  def test_rejects_corrupt_state_instead_of_resetting_it
    Dir.mktmpdir('dba-scanner-state') do |directory|
      path = File.join(directory, 'seen.json')
      File.write(path, '{not json')
      store = DbaMaterialsScanner::StateStore.new(path)

      assert_raises(DbaMaterialsScanner::Error) { store.load }
    end
  end
end
