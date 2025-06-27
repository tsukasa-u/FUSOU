import { createClient } from '@supabase/supabase-js'
import { Auth } from '@supabase/auth-ui-solid'

// const supabase = createClient(  process.env.SUPABASE_URL,  process.env.SUPABASE_ANON_KEY)

const supabase = createClient(
    "https://dzhbfibxxijxxhrvbqds.supabase.co", 
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6aGJmaWJ4eGlqeHhocnZicWRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDM4NzA1MzMsImV4cCI6MjA1OTQ0NjUzM30.JfOWL__28gwCEspAQCtphPaJrSS4B1qAIIe2qWTcrDM"
);


const LoginDashBoard = () => (
    <>
        <Auth  supabaseClient={supabase} providers={['google', 'facebook', 'twitter']} />
        <Auth  supabaseClient={supabase}  view="sign_up"/>
    </>
    
);


export default LoginDashBoard