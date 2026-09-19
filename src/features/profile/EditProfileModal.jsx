import React, { useState } from "react";
import { updateProfile } from "../../services/mvpService";
import { ModalShell } from "../../components/ui/Shell";

const LINKEDIN_URL_PATTERN = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/.+/i;

const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/.+/i;

function EditProfileModal({ profile, onClose, onSaved, notify }) {
  const [form, setForm] = useState({
    name: profile.name || "",
    course: profile.course || "",
    year: profile.year || "",
    usn: profile.usn || "",
    roll_number: profile.roll_number || "",
    department: profile.department || "",
    bio: profile.bio || "",
    skills: (profile.skills || []).join(", "),
    achievements: (profile.achievements || []).join(", "),
    linkedin_url: profile.linkedin_url || "",
    github_url: profile.github_url || "",
    open_to_projects: Boolean(profile.open_to_projects),
  });
  const [saving, setSaving] = useState(false);
  const change = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  return <ModalShell kicker="PROFILE" title="Edit profile" onClose={onClose}>
    <div className="form-grid">
      <label>Name<input value={form.name} onChange={(e) => change("name", e.target.value)} /></label>
      <label>USN<input value={form.usn} onChange={(e) => change("usn", e.target.value)} /></label>
      <label>Course<input value={form.course} onChange={(e) => change("course", e.target.value)} /></label>
      <label>Year<input value={form.year} onChange={(e) => change("year", e.target.value)} /></label>
      <label>Roll number<input value={form.roll_number} onChange={(e) => change("roll_number", e.target.value)} placeholder="Optional" /></label>
      <label>Department<input value={form.department} onChange={(e) => change("department", e.target.value)} placeholder="e.g. Computer Science & Engineering" /></label>
    </div>
    <label>Bio<textarea value={form.bio} onChange={(e) => change("bio", e.target.value)} placeholder="What are you building or learning?" /></label>
    <label>Skills (comma separated)<input value={form.skills} onChange={(e) => change("skills", e.target.value)} placeholder="React, Python, Design" /></label>
    <label>Achievements (comma separated)<input value={form.achievements} onChange={(e) => change("achievements", e.target.value)} placeholder="Hackathon winner, Published paper, Club lead" /></label>
    <div className="form-grid">
      <label>LinkedIn URL<input value={form.linkedin_url} onChange={(e) => change("linkedin_url", e.target.value)} placeholder="https://linkedin.com/in/you" /></label>
      <label>GitHub URL<input value={form.github_url} onChange={(e) => change("github_url", e.target.value)} placeholder="https://github.com/you" /></label>
    </div>
    <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={form.open_to_projects} onChange={(e) => change("open_to_projects", e.target.checked)} /> Open to projects</label>
    <button className="primary wide" disabled={saving} onClick={async () => {
      const linkedin = form.linkedin_url.trim();
      const github = form.github_url.trim();
      if (linkedin && !LINKEDIN_URL_PATTERN.test(linkedin)) {
        notify("LinkedIn URL should look like https://linkedin.com/in/you");
        return;
      }
      if (github && !GITHUB_URL_PATTERN.test(github)) {
        notify("GitHub URL should look like https://github.com/you");
        return;
      }
      try {
        setSaving(true);
        const next = await updateProfile(profile.id, {
          ...form,
          skills: form.skills.split(",").map((skill) => skill.trim()).filter(Boolean),
          achievements: form.achievements.split(",").map((achievement) => achievement.trim()).filter(Boolean),
          linkedin_url: linkedin,
          github_url: github,
        });
        onSaved(next);
      }
      catch (error) { notify(error.message || "Could not update profile"); } finally { setSaving(false); }
    }}>{saving ? "Saving…" : "Save profile"}</button>
  </ModalShell>;
}

export { EditProfileModal, GITHUB_URL_PATTERN, LINKEDIN_URL_PATTERN };
