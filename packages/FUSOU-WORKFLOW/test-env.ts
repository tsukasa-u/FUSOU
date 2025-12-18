// Test endpoint to verify environment variables
import '@dotenvx/dotenvx/config';

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === '/test-env') {
      // @ts-ignore
      const processEnv = typeof process !== 'undefined' ? process.env : {};
      
      return new Response(JSON.stringify({
        success: true,
        test: 'Environment variable test',
        has_process: typeof process !== 'undefined',
        process_env_keys: Object.keys(processEnv).filter(k => k.includes('SUPABASE')),
        process_env_url: processEnv.PUBLIC_SUPABASE_URL?.substring(0, 30) + '...',
        timestamp: new Date().toISOString()
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    return new Response('Not found', { status: 404 });
  }
};
