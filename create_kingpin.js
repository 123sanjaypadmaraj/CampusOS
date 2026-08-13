import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function run() {
  console.log('1. Signing up user...');
  const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
    email: 'sanjaypadmaraj@nhce.edu.in',
    password: 'CampusOS@2026',
    options: {
      data: {
        name: 'Sanjay Padmaraj',
        usn: '1NH22CS101'
      }
    }
  });

  if (signUpErr) {
    console.error('Signup Error:', signUpErr.message);
    return;
  }
  
  console.log('User created:', signUpData.user.id);
  
  console.log('2. Testing login...');
  const { data: loginData, error: loginErr } = await supabase.auth.signInWithPassword({
    email: 'sanjaypadmaraj@nhce.edu.in',
    password: 'CampusOS@2026',
  });
  
  if (loginErr) {
    console.error('Login Error:', loginErr.message);
  } else {
    console.log('Login Success! Session valid for:', loginData.user.email);
  }
}
run();
