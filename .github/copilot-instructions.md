# Copilot Instructions

<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

This is an MCP (Model Context Protocol) server project for integrating with Wargaming API for World of Tanks Console.

## Project Overview

-   **Purpose**: Create an MCP server that provides LLMs with access to Wargaming API data for World of Tanks Console
-   **Language**: TypeScript
-   **Framework**: MCP SDK
-   **API**: Wargaming API (specifically World of Tanks Console endpoints)

## Key Features

-   Player statistics lookup
-   Tank/vehicle information
-   Clan data retrieval
-   Battle history access
-   Achievement tracking

## Development Guidelines

-   Follow TypeScript best practices
-   Use Zod for input validation
-   Implement proper error handling for API calls
-   Include rate limiting considerations
-   Document all API endpoints and parameters
-   Use environment variables for API keys

## MCP Server Resources

You can find more info and examples at https://modelcontextprotocol.io/llms-full.txt

## Wargaming API

-   Base URL: https://api-modernarmor.worldoftanks.com (for both Xbox and PlayStation)
-   Requires application ID for authentication
-   Rate limited (max 10 requests per second)
