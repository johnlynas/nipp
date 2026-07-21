import { NextRequest } from 'next/server';

/**
 * A specialized client for making requests to Next.js API routes during integration tests.
 * It abstracts the creation of Request objects and common headers.
 */
export class TestApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  /**
   * Creates a Request object for the specified path and method.
   * 
   * @param path - The API endpoint (e.g., '/api/auth/sign-in/email')
   * @param method - HTTP Method (GET, POST, etc.)
   * @param body - The request body (will be stringified)
   * @param extraHeaders - Additional headers to include
   */
  async createRequest(
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET',
    body?: unknown,
    extraHeaders: Record<string, string> = {}
  ): Promise<Request> {
    const url = new URL(`${this.baseUrl}${path}`);
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    return new Request(url.toString(), options);
  }

  /**
   * Helper for POST requests
   */
  async post(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.createRequest(path, 'POST', body, headers);
  }

  /**
   * Helper for GET requests
   */
  async get(path: string, headers?: Record<string, string>) {
    return this.createRequest(path, 'GET', undefined, headers);
  }

  /**
   * Helper for DELETE requests
   */
  async delete(path: string, headers?: Record<string, string>) {
    return this.createRequest(path, 'DELETE', undefined, headers);
  }
}

export const testClient = new TestApiClient();
