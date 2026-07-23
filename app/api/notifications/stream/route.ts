import { NextRequest } from 'next/server';

/**
 * Mock SSE (Server-Sent Events) Route Handler
 * This simulates a real-time notification stream from the server.
 */

export const runtime = 'edge'; // SSE works best on Edge/Node runtimes

export async function GET(req: NextRequest) {
  const responseStream = new TransformStream();
  const writer = responseStream.writable.getWriter();
  const encoder = new TextEncoder();

  // Function to send a formatted SSE message
  const sendEvent = async (data: any) => {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    await writer.write(encoder.encode(message));
  };

  // Simulation loop: Send a random notification every 10-20 seconds
  const intervalId = setInterval(async () => {
    try {
      const types: Array<'info' | 'warning' | 'error'> = ['info', 'warning', 'error'];
      const randomType = types[Math.floor(Math.random() * types.length)];
      
      const notification = {
        id: `mock-notif-${Date.now()}`,
        message: `New ${randomType} notification at ${new Date().toLocaleTimeString()}`,
        type: randomType,
        read: false,
        createdAt: new Date().toISOString(),
      };

      await sendEvent(notification);
    } catch (err) {
      console.error('SSE Simulation Error:', err);
    }
  }, 15000); // Push every 15 seconds

  // Handle client disconnection
  req.signal.addEventListener('abort', () => {
    clearInterval(intervalId);
    writer.close();
  });

  return new Response(responseStream.readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}
