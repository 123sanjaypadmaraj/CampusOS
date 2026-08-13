import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function testSignup() {
  const { data, error } = await supabase.auth.signUp({
    email: 'test_admin_999@nhce.edu.in',
    password: 'CampusOS@2026',
  });
  console.log('Signup result:', error ? error.message : 'Success! User ID: ' + data.user.id);
}
testSignup();
