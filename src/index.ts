#!/usr/bin/env node

/**
 * BigQuery Analysis MCP Server
 * 
 * This server provides tools to:
 * - Perform a dry run of a BigQuery query to check if it's valid and estimate its size
 * - Run a BigQuery query if the dry run succeeds and is less than 1 TB
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { BigQuery } from "@google-cloud/bigquery";
import { z } from "zod";

// Initialize BigQuery client
// Note: This uses application default credentials
// The user needs to have set up authentication via gcloud CLI or service account
const bigquery = new BigQuery();

// Size limit for queries (1 TB in bytes)
const SIZE_LIMIT_BYTES = 1_099_511_627_776; // 1 TB

/**
 * Function to check if a query contains DML statements
 * @param query The SQL query to check
 * @returns An object with a boolean indicating if DML was detected and a message
 */
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

/**
 * Create an MCP server with BigQuery tools
 */
const server = new McpServer({
  name: "bigquery-analysis-server",
  version: "0.1.0",
});

/**
 * Tool: Perform a dry run of a BigQuery query
 */
server.tool(
  "dry_run_query",
  "Perform a dry run of a BigQuery query to check if it's valid and estimate its size",
  {
    query: z.string().describe("The SQL query to dry run"),
    projectId: z.string().optional().describe("Google Cloud project ID (optional, uses default if not provided)")
  },
  async ({ query, projectId }) => {
    if (!query) {
      throw new McpError(ErrorCode.InvalidParams, "Query is required");
    }

    try {
      // Create query options with dryRun flag
      const options = {
        query,
        dryRun: true,
        ...(projectId && { projectId })
      };

      // Execute the dry run
      const [job] = await bigquery.createQueryJob(options);
      const metadata = job.metadata;
      
      // Get the total bytes processed
      const totalBytesProcessed = metadata.statistics.totalBytesProcessed;
      const isBelowLimit = BigInt(totalBytesProcessed) < BigInt(SIZE_LIMIT_BYTES);
      
      // Format size in a human-readable format
      const sizeInGB = Number(totalBytesProcessed) / (1024 * 1024 * 1024);
      const sizeInTB = sizeInGB / 1024;
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            bytesProcessed: totalBytesProcessed,
            formattedSize: `${sizeInGB.toFixed(2)} GB (${sizeInTB.toFixed(4)} TB)`,
            isBelowLimit,
            message: isBelowLimit ? 
              `Dry run successful. Query will process ${sizeInGB.toFixed(2)} GB, which is below the 1 TB limit.` :
              `Dry run successful, but query will process ${sizeInGB.toFixed(2)} GB, which exceeds the 1 TB limit.`
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Dry run error:", error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }
);

/**
 * Tool: Run a BigQuery query with validation
 */
server.tool(
  "run_query_with_validation",
  "Run a BigQuery query with dry run validation (fails if query exceeds 1 TB or contains DML statements)",
  {
    query: z.string().describe("The SQL query to run (only SELECT queries are allowed)"),
    projectId: z.string().optional().describe("Google Cloud project ID (optional, uses default if not provided)"),
    maxResults: z.number().optional().describe("Maximum number of results to return (default: 100)")
  },
  async ({ query, projectId, maxResults = 100 }) => {
    if (!query) {
      throw new McpError(ErrorCode.InvalidParams, "Query is required");
    }

    // Check if the query contains DML statements
    const dmlCheck = containsDMLStatements(query);
    if (dmlCheck.isDML) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: dmlCheck.message
          }, null, 2)
        }]
      };
    }

    try {
      // First perform a dry run to check the query size
      const options = {
        query,
        dryRun: true,
        ...(projectId && { projectId })
      };

      const [job] = await bigquery.createQueryJob(options);
      const metadata = job.metadata;
      
      // Get the total bytes processed
      const totalBytesProcessed = metadata.statistics.totalBytesProcessed;
      const isBelowLimit = BigInt(totalBytesProcessed) < BigInt(SIZE_LIMIT_BYTES);
      
      // Format size in a human-readable format
      const sizeInGB = Number(totalBytesProcessed) / (1024 * 1024 * 1024);
      
      if (!isBelowLimit) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              bytesProcessed: totalBytesProcessed,
              formattedSize: `${sizeInGB.toFixed(2)} GB`,
              error: `Query would process ${sizeInGB.toFixed(2)} GB, which exceeds the 1 TB limit.`
            }, null, 2)
          }]
        };
      }
      
      // If the query is below the size limit, run it
      const [rows] = await bigquery.query({
        query,
        ...(projectId && { projectId }),
        maxResults
      });
      
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            bytesProcessed: totalBytesProcessed,
            formattedSize: `${sizeInGB.toFixed(2)} GB`,
            rowCount: rows.length,
            results: rows
          }, null, 2)
        }]
      };
    } catch (error) {
      console.error("Query error:", error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          }, null, 2)
        }]
      };
    }
  }
);

/**
 * Start the server using stdio transport
 */
async function main() {
  console.log("Starting BigQuery Analysis MCP Server...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("Server connected to transport");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
