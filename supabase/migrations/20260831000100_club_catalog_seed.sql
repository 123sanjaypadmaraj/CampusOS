-- =============================================================================
-- CLUB CATALOG SEED -- the college's real club roster (30 clubs across the
-- two categories the college actually organizes clubs under), replacing the
-- 4 placeholder dev-seed clubs (20260814001300_seed_dev_data.sql) as the
-- catalog students actually see on the Clubs Hub. Idempotent upsert on
-- (campus_id, name) -- safe to re-run, and doesn't touch the old dev-seed
-- rows (AI Club/Robotics Club/Coding Club/Design Club) so any real
-- membership already recorded against them isn't lost.
--
-- Each row gets recruitment_mode='open' (instant join) by default -- a club
-- owner can switch to 'application' or 'closed' from their own dashboard
-- (Club Manage -> Overview -> Recruitment) once they're signed in; see
-- scripts/setup-club-accounts.mjs for the owner accounts.
-- =============================================================================

insert into public.clubs (campus_id, name, category, description, recruitment_mode)
select c.id, v.name, v.category, v.description, 'open'
from public.campuses c
cross join (values
  -- Co-Curricular / Technical Clubs
  ('Emsys Next Gen Club', 'Co-Curricular / Technical', 'Embedded systems, IoT and next-gen electronics projects.'),
  ('Business & Information Technology Club (B.I.T Club)', 'Co-Curricular / Technical', 'Where business strategy meets IT -- case studies, consulting projects and tech-business crossover events.'),
  ('Healthxxcel Club', 'Co-Curricular / Technical', 'Health-tech, wellness innovation and healthcare-focused projects.'),
  ('Cybersecurity & Ethical Hacking Club', 'Co-Curricular / Technical', 'CTFs, pentesting practice, security workshops and responsible disclosure culture.'),
  ('Data Analytics Club', 'Co-Curricular / Technical', 'Data storytelling, dashboards, statistics and analytics case competitions.'),
  ('Mobile App Development Club', 'Co-Curricular / Technical', 'Android/iOS/cross-platform app-building sprints and showcases.'),
  ('Aerobots Club', 'Co-Curricular / Technical', 'Drones, UAVs and aerial robotics builds and competitions.'),
  ('FOSS Club', 'Co-Curricular / Technical', 'Free and open-source software -- contributions, Linux, and community projects.'),
  ('RoboHorizon Club', 'Co-Curricular / Technical', 'Ground robotics, automation and competitive robotics builds.'),
  ('Innovation Club', 'Co-Curricular / Technical', 'Cross-discipline prototyping, design thinking and innovation challenges.'),
  ('EvolveAI Club', 'Co-Curricular / Technical', 'Machine learning, AI research reading groups and applied ML projects.'),
  ('TechForge Club', 'Co-Curricular / Technical', 'Hardware-software builds, maker projects and hackathon prep.'),
  ('Entrepreneurship Development & Startup Club', 'Co-Curricular / Technical', 'Startup ideation, pitching, mentorship and founder-track events.'),
  ('Green Energy Club', 'Co-Curricular / Technical', 'Renewable energy, sustainability tech and clean-energy projects.'),
  ('STEM Club', 'Co-Curricular / Technical', 'Science, technology, engineering and maths outreach and project work.'),
  -- Extra-Curricular Clubs
  ('Alumni Club', 'Extra-Curricular', 'Keeps alumni connected to campus -- mentorship, reunions and networking.'),
  ('Music Club', 'Extra-Curricular', 'Bands, performances, jam sessions and music production.'),
  ('Art Club', 'Extra-Curricular', 'Painting, sketching, visual arts workshops and exhibitions.'),
  ('NSS Club', 'Extra-Curricular', 'National Service Scheme -- community service and social outreach.'),
  ('Leo Club', 'Extra-Curricular', 'Youth wing of Lions Clubs International -- service projects and leadership.'),
  ('Drama Club', 'Extra-Curricular', 'Theatre, street plays, scriptwriting and stage performances.'),
  ('Literary Club', 'Extra-Curricular', 'Debate, creative writing, poetry and book discussions.'),
  ('Fashion Club', 'Extra-Curricular', 'Styling, design and campus fashion shows.'),
  ('Fitness Club', 'Extra-Curricular', 'Fitness challenges, group workouts and wellness events.'),
  ('Rotaract Club', 'Extra-Curricular', 'Youth wing of Rotary International -- service and leadership projects.'),
  ('Green Warriors Club', 'Extra-Curricular', 'Environmental action, campus sustainability and clean-up drives.'),
  ('Socio-Political Club', 'Extra-Curricular', 'Current affairs, policy discussions and Model UN-style debate.'),
  ('TEDx Club', 'Extra-Curricular', 'Organizes the campus'' independently run TEDx events and speaker sessions.'),
  ('Media Club', 'Extra-Curricular', 'Campus photography, videography and social media coverage.'),
  ('Dance Club', 'Extra-Curricular', 'Choreography, dance crews and performance events.')
) as v(name, category, description)
where c.slug = 'nhce'
on conflict (campus_id, name) do update set
  category = excluded.category,
  description = excluded.description;
