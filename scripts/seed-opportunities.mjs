// One-off seed: a handful of real opportunities/mentors so the board isn't
// empty for real users (doc §109). Idempotent (only inserts if a campus
// has none yet).
//
// Usage: node scripts/seed-opportunities.mjs --env=production --yes-production

import { resolveTarget, runProjectSql } from "./env-target.mjs";

const { root, projectRef } = resolveTarget();

const sql = `
  do $$
  declare
    v_campus uuid;
    v_admin uuid;
  begin
    select id into v_campus from public.campuses limit 1;
    select id into v_admin from public.profiles where role = 'super_admin' limit 1;

    if not exists (select 1 from public.opportunities where campus_id = v_campus) then
      insert into public.opportunities (campus_id, posted_by, company, role, type, description, tags, deadline) values
        (v_campus, v_admin, 'Campus Innovation Lab', 'AI Research Intern', 'Research',
         'Work with faculty on applied ML projects across two semesters. Python and a course in ML/stats required.',
         array['Python','ML'], current_date + interval '14 days'),
        (v_campus, v_admin, 'Tech Startup Hub', 'React Developer', 'Internship',
         'Build features for the campus incubator''s portfolio companies. React + Node experience preferred.',
         array['React','Node'], current_date + interval '21 days'),
        (v_campus, v_admin, 'Robotics Lab', 'Embedded Systems Intern', 'Research',
         'ESP32/ROS work on the campus rover project. C++ required, CAD a plus.',
         array['ESP32','C++'], current_date + interval '30 days');
    end if;

    if not exists (select 1 from public.mentors where campus_id = v_campus) then
      insert into public.mentors (campus_id, added_by, name, role, skills, bio) values
        (v_campus, v_admin, 'Prof. Rahul Nair', 'Robotics & Embedded Systems', array['ESP32','ROS','CAD'],
         'Runs the campus robotics lab; happy to advise on embedded projects and competition entries.'),
        (v_campus, v_admin, 'Dr. Meera Thomas', 'AI / Computer Vision', array['Python','CV','LLMs'],
         'Faculty advisor for the AI club; office hours by request for research-track students.'),
        (v_campus, v_admin, 'Arjun Menon', 'Startup & Product', array['React','Product','Pitching'],
         'Alumnus running a campus-incubated startup; mentors on product/pitching for student founders.');
    end if;
  end $$;
`;

runProjectSql(root, projectRef, sql);
console.log("[done] seeded opportunities/mentors (no-op if already present)");
