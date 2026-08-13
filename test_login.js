import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function testLogin() {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'sanjaypadmaraj@nhce.edu.in',
    password: 'CampusOS@2026',
  });
  console.log('Login result:', error ? error.message : 'Success! User ID: ' + data.user.id);
}
testLogin();
