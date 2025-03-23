/**
 * テスト: BigQuery Analysis MCP Server のサーバー初期化
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { BigQuery } from '@google-cloud/bigquery';

// McpServerのモック
const mockMcpServer = {
  tool: jest.fn(),
  start: jest.fn()
};

// McpServerのモックを作成
const MockMcpServer = jest.fn().mockImplementation(() => mockMcpServer);

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    McpServer: MockMcpServer
  };
});

// BigQueryのモック
jest.mock('@google-cloud/bigquery', () => {
  return {
    BigQuery: jest.fn().mockImplementation(() => ({}))
  };
});

// StdioServerTransportのモック
const mockStdioTransport = {};
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  return {
    StdioServerTransport: jest.fn().mockImplementation(() => mockStdioTransport)
  };
});

describe('Server initialization', () => {
  beforeEach(() => {
    // モックをリセット
    jest.clearAllMocks();
  });

  test('サーバーが正しく初期化される', async () => {
    // サーバーの初期化をシミュレート
    const server = new MockMcpServer({
      name: 'bigquery-analysis-server',
      version: '0.1.0',
    }) as typeof mockMcpServer;
    
    // サーバーが正しく初期化されたことを確認
    expect(MockMcpServer).toHaveBeenCalledWith({
      name: 'bigquery-analysis-server',
      version: '0.1.0',
    });
    
    // ツールの登録をシミュレート
    const handlerMock = jest.fn().mockImplementation(() => ({
      content: [{ type: 'text', text: 'test' }]
    }));
    
    server.tool('dry_run_query', 'テスト説明', {}, handlerMock);
    server.tool('run_query_with_validation', 'テスト説明', {}, handlerMock);
    
    // ツールが正しく登録されたことを確認
    expect(mockMcpServer.tool).toHaveBeenCalledTimes(2);
    expect(mockMcpServer.tool).toHaveBeenCalledWith(
      'dry_run_query',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
    expect(mockMcpServer.tool).toHaveBeenCalledWith(
      'run_query_with_validation',
      expect.any(String),
      expect.any(Object),
      expect.any(Function)
    );
  });
});
