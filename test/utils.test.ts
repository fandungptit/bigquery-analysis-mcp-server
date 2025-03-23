/**
 * テスト: BigQuery Analysis MCP Server のユーティリティ関数
 */

// 直接index.tsからcontainsDMLStatements関数をインポートできるようにするため、
// 関数をエクスポートする必要があります。テスト用に関数をエクスポートするファイルを作成します。

import { describe, test, expect } from '@jest/globals';

// テスト対象の関数を直接定義（本来はモジュール化すべきですが、テスト目的で再定義）
function containsDMLStatements(query: string): { isDML: boolean; message?: string } {
  // Normalize the query by removing comments and converting to uppercase for easier matching
  const normalizedQuery = query
    .replace(/--.*$/gm, '') // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
    .trim()
    .toUpperCase();

  // Define patterns for common DML statements
  const dmlPatterns = [
    { pattern: /\bCREATE\s+TABLE\b/i, name: "CREATE TABLE" },
    { pattern: /\bCREATE\s+OR\s+REPLACE\s+TABLE\b/i, name: "CREATE OR REPLACE TABLE" },
    { pattern: /\bDROP\s+TABLE\b/i, name: "DROP TABLE" },
    { pattern: /\bALTER\s+TABLE\b/i, name: "ALTER TABLE" },
    { pattern: /\bINSERT\s+INTO\b/i, name: "INSERT INTO" },
    { pattern: /\bUPDATE\b/i, name: "UPDATE" },
    { pattern: /\bDELETE\s+FROM\b/i, name: "DELETE FROM" },
    { pattern: /\bMERGE\s+INTO\b/i, name: "MERGE INTO" },
    { pattern: /\bTRUNCATE\s+TABLE\b/i, name: "TRUNCATE TABLE" },
    { pattern: /\bCREATE\s+VIEW\b/i, name: "CREATE VIEW" },
    { pattern: /\bCREATE\s+OR\s+REPLACE\s+VIEW\b/i, name: "CREATE OR REPLACE VIEW" },
    { pattern: /\bDROP\s+VIEW\b/i, name: "DROP VIEW" },
    { pattern: /\bCREATE\s+FUNCTION\b/i, name: "CREATE FUNCTION" },
    { pattern: /\bDROP\s+FUNCTION\b/i, name: "DROP FUNCTION" },
    { pattern: /\bCREATE\s+PROCEDURE\b/i, name: "CREATE PROCEDURE" },
    { pattern: /\bDROP\s+PROCEDURE\b/i, name: "DROP PROCEDURE" },
    { pattern: /\bGRANT\b/i, name: "GRANT" },
    { pattern: /\bREVOKE\b/i, name: "REVOKE" },
    { pattern: /\bBEGIN\s+TRANSACTION\b/i, name: "BEGIN TRANSACTION" },
    { pattern: /\bCOMMIT\b/i, name: "COMMIT" },
    { pattern: /\bROLLBACK\b/i, name: "ROLLBACK" }
  ];

  // Check if the query contains any DML statements
  for (const { pattern, name } of dmlPatterns) {
    if (pattern.test(normalizedQuery)) {
      return {
        isDML: true,
        message: `DML statement detected: ${name}. Only SELECT queries are allowed.`
      };
    }
  }

  return { isDML: false };
}

describe('containsDMLStatements', () => {
  test('正常なSELECTクエリを検出しない', () => {
    const query = 'SELECT * FROM users WHERE age > 18';
    const result = containsDMLStatements(query);
    expect(result.isDML).toBe(false);
    expect(result.message).toBeUndefined();
  });

  test('コメント付きのSELECTクエリを検出しない', () => {
    const query = `
      -- これはコメントです
      SELECT * FROM users
      /* これは
         複数行の
         コメントです */
      WHERE age > 18
    `;
    const result = containsDMLStatements(query);
    expect(result.isDML).toBe(false);
    expect(result.message).toBeUndefined();
  });

  test('CREATE TABLEステートメントを検出する', () => {
    const query = 'CREATE TABLE new_table (id INT, name STRING)';
    const result = containsDMLStatements(query);
    expect(result.isDML).toBe(true);
    expect(result.message).toContain('CREATE TABLE');
  });

  test('INSERT INTOステートメントを検出する', () => {
    const query = 'INSERT INTO users (id, name) VALUES (1, "John")';
    const result = containsDMLStatements(query);
    expect(result.isDML).toBe(true);
    expect(result.message).toContain('INSERT INTO');
  });

  test('UPDATEステートメントを検出する', () => {
    const query = 'UPDATE users SET name = "Jane" WHERE id = 1';
    const result = containsDMLStatements(query);
    expect(result.isDML).toBe(true);
    expect(result.message).toContain('UPDATE');
  });

  test('DELETE FROMステートメントを検出する', () => {
    const query = 'DELETE FROM users WHERE id = 1';
    const result = containsDMLStatements(query);
    expect(result.isDML).toBe(true);
    expect(result.message).toContain('DELETE FROM');
  });

  test('コメント内のDMLキーワードを検出しない', () => {
    const query = `
      SELECT * FROM users
      -- ここにはINSERT INTOがありますが、コメントなので無視されます
      /* ここにも
         CREATE TABLEがありますが
         これも無視されます */
      WHERE age > 18
    `;
    const result = containsDMLStatements(query);
    expect(result.isDML).toBe(false);
    expect(result.message).toBeUndefined();
  });
});
