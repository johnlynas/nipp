import { NextResponse } from 'next/server';

/**
 * CSP Violation Reporting Endpoint
 * 
 * Receives POST requests from browsers when CSP violations occur.
 * Useful for monitoring in production before switching to enforcement mode.
 */

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Log the violation (in production, send to monitoring service)
    console.warn('[CSP Violation]', {
      timestamp: new Date().toISOString(),
      documentURI: body['document-uri'],
      referrer: body['referrer'],
      violatedDirective: body['violated-directive'],
      blockedURI: body['blocked-uri'],
      lineNumber: body['line-number'],
      columnNumber: body['column-number'],
      originalPolicy: body['original-policy'],
    });

    return NextResponse.json({ status: 'ok' }, { status: 200 });
  } catch (error) {
    console.error('Failed to process CSP report:', error);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
