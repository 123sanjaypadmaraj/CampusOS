import React, { useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "../../components/ui/States";
import { startConversation } from "../../services/messagingService";
import { getCohortGroupMembers, getCohortGroups, getPeopleYouMayKnow } from "../../services/mvpService";
import { FaGithub, FaLinkedin } from "react-icons/fa6";
import { HiArrowRight, HiChatBubbleLeftRight, HiChevronRight, HiMagnifyingGlass, HiSparkles, HiTrophy, HiUserGroup, HiUserPlus } from "react-icons/hi2";
import { ModalShell, PageHeader } from "../../components/ui/Shell";

function Socialize({ notify, people = [], profile, campusId, authUser, openLogin, onOpenConversation }) {
  const [tab, setTab] = useState("directory"); // 'directory' | 'suggestions' | 'groups'
  const [query, setQuery] = useState("");
  const [courseFilter, setCourseFilter] = useState("All");
  const [yearFilter, setYearFilter] = useState("All");
  const [openOnly, setOpenOnly] = useState(false);

  const classmates = useMemo(
    () => people.filter((person) => person.id !== profile?.id),
    [people, profile?.id]
  );

  const courses = useMemo(() => {
    const set = new Set(classmates.map((person) => person.course).filter(Boolean));
    return Array.from(set).sort();
  }, [classmates]);

  const years = useMemo(() => {
    const set = new Set(classmates.map((person) => person.year).filter(Boolean));
    return Array.from(set).sort();
  }, [classmates]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return classmates.filter((person) => {
      if (courseFilter !== "All" && person.course !== courseFilter) return false;
      if (yearFilter !== "All" && person.year !== yearFilter) return false;
      if (openOnly && !person.open_to_projects) return false;
      if (!q) return true;
      const haystack = [
        person.name,
        person.course,
        ...(person.skills || []),
        ...(person.achievements || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [classmates, courseFilter, yearFilter, openOnly, query]);

  const sameBranchCount = profile?.course
    ? classmates.filter((person) => person.course === profile.course).length
    : 0;

  return (
    <section className="page-section socialize-page">
      <PageHeader
        kicker="YOUR CAMPUS COHORT"
        title="Connect"
        text="Find classmates, browse by branch and year, and see the achievements they've chosen to share."
        action={
          profile?.course ? (
            <button
              className="primary"
              onClick={() => {
                setCourseFilter(profile.course);
                notify(`Showing your ${profile.course} classmates`);
              }}
            >
              <HiUserGroup /> My branch
            </button>
          ) : null
        }
      />

      <div className="chips" style={{ marginBottom: 20 }}>
        <button className={tab === "directory" ? "chip active" : "chip"} onClick={() => setTab("directory")}>
          Directory
        </button>
        <button className={tab === "suggestions" ? "chip active" : "chip"} onClick={() => setTab("suggestions")}>
          <HiSparkles /> Suggested for you
        </button>
        <button className={tab === "groups" ? "chip active" : "chip"} onClick={() => setTab("groups")}>
          <HiUserGroup /> Groups
        </button>
      </div>

      {tab === "suggestions" && <SuggestedForYou notify={notify} authUser={authUser} openLogin={openLogin} onOpenConversation={onOpenConversation} />}
      {tab === "groups" && <CohortGroups notify={notify} campusId={campusId} profile={profile} />}

      {tab === "directory" && (
      <>
      <div className="socialize-hero">
        <div>
          <span className="section-kicker">CLASSMATE DIRECTORY</span>
          <h2>Know your campus, one classmate at a time.</h2>
          <p>
            Everyone here is a verified student on your campus. Add your own
            achievements from your profile so others can find them too.
          </p>
        </div>

        <div className="socialize-stats">
          <div><b>{classmates.length}</b><small>students on campus</small></div>
          <div><b>{courses.length}</b><small>branches</small></div>
          <div><b>{sameBranchCount}</b><small>in your branch</small></div>
        </div>
      </div>

      <div className="searchbar compact wide-search">
        <HiMagnifyingGlass />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search classmates, skills or achievements..."
          aria-label="Search classmates, skills or achievements"
        />
      </div>

      <div className="socialize-filter-row">
        <button
          className={courseFilter === "All" ? "chip active" : "chip"}
          onClick={() => setCourseFilter("All")}
        >
          All branches
        </button>
        {courses.map((course) => (
          <button
            key={course}
            className={courseFilter === course ? "chip active" : "chip"}
            onClick={() => setCourseFilter(course)}
          >
            {course}
          </button>
        ))}
      </div>

      <div className="socialize-filter-row">
        <button
          className={yearFilter === "All" ? "chip active" : "chip"}
          onClick={() => setYearFilter("All")}
        >
          All years
        </button>
        {years.map((year) => (
          <button
            key={year}
            className={yearFilter === year ? "chip active" : "chip"}
            onClick={() => setYearFilter(year)}
          >
            {year}
          </button>
        ))}
        <button
          className={openOnly ? "chip active" : "chip"}
          onClick={() => setOpenOnly((current) => !current)}
        >
          Open to projects
        </button>
      </div>

      <div className="socialize-layout">
        <div className="socialize-feed people-grid">
          {filtered.length === 0 && (
            <EmptyState
              icon={<HiUserGroup />}
              title="No classmates match yet"
              text="Try a different branch, year or search term."
            />
          )}
          {filtered.map((person) => (
            <ClassmateCard key={person.id} person={person} notify={notify} authUser={authUser} openLogin={openLogin} onOpenConversation={onOpenConversation} />
          ))}
        </div>

        <aside className="socialize-sidebar">
          <span className="section-kicker">BROWSE BY BRANCH</span>
          {courses.map((course) => (
            <button key={course} onClick={() => setCourseFilter(course)}>
              <span>{classmates.filter((person) => person.course === course).length}</span>
              <div>
                <b>{course}</b>
                <small>
                  {classmates.filter((person) => person.course === course).length} students
                </small>
              </div>
              <HiChevronRight />
            </button>
          ))}

          <div className="socialize-note">
            <HiUserGroup />
            <b>Your campus network</b>
            <small>
              Only verified students on your own campus show up here — no
              outside colleges, no spoofed activity.
            </small>
          </div>
        </aside>
      </div>
      </>
      )}
    </section>
  );
}

function SuggestedForYou({ notify, authUser, openLogin, onOpenConversation }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState([]);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setSuggestions(await getPeopleYouMayKnow({ limit: 12 }));
    } catch (err) {
      setError(err.message || "Could not load suggestions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Finding people you may know…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;
  if (suggestions.length === 0) {
    return (
      <EmptyState
        icon={<HiSparkles />}
        title="No suggestions yet"
        text="Join a club, post something, or fill in your branch and year — the more the campus knows about you, the better these get."
      />
    );
  }

  return (
    <div className="socialize-feed people-grid">
      {suggestions.map((person) => (
        <SuggestedPersonCard key={person.id} person={person} notify={notify} authUser={authUser} openLogin={openLogin} onOpenConversation={onOpenConversation} />
      ))}
    </div>
  );
}

function SuggestedPersonCard({ person, notify, authUser, openLogin, onOpenConversation }) {
  const [messaging, setMessaging] = useState(false);
  const reasons = [];
  if (person.course) reasons.push(`Same branch (${person.course})`);
  if (person.year) reasons.push(person.year);
  if (person.shared_clubs > 0) reasons.push(`${person.shared_clubs} club${person.shared_clubs > 1 ? "s" : ""} in common`);
  if (person.shared_tags > 0) reasons.push(`${person.shared_tags} shared interest${person.shared_tags > 1 ? "s" : ""}`);

  return (
    <article className="person-card">
      <div className="person-top">
        <div className="big-avatar small">{person.name?.[0] || "?"}</div>
        <div>
          <h3>{person.name}</h3>
          <p>{person.course} · {person.year}</p>
        </div>
        <span className="match">{person.score}%</span>
      </div>

      {reasons.length > 0 && (
        <p className="classmate-bio">{reasons.join(" · ")}</p>
      )}

      {person.skills?.length > 0 && (
        <div className="skill-list">
          {person.skills.map((skill) => <span key={skill}>{skill}</span>)}
        </div>
      )}

      <div className="person-actions">
        <button onClick={() => notify(`Connection request sent to ${person.name}`)}>
          <HiUserPlus /> Connect
        </button>
        <button
          className="ghost"
          disabled={messaging}
          onClick={async () => {
            if (!authUser) { openLogin?.(); notify("Sign in to send a message"); return; }
            try {
              setMessaging(true);
              const conversationId = await startConversation(person.id);
              onOpenConversation?.(conversationId);
            } catch (error) {
              notify(error.message || "Could not start a conversation");
            } finally {
              setMessaging(false);
            }
          }}
        >
          <HiChatBubbleLeftRight /> {messaging ? "Starting…" : "Message"}
        </button>
      </div>
    </article>
  );
}

function CohortGroups({ notify, campusId, profile }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState([]);
  const [openGroup, setOpenGroup] = useState(null);

  const reload = async () => {
    try {
      setLoading(true);
      setError("");
      setGroups(await getCohortGroups(campusId));
    } catch (err) {
      setError(err.message || "Could not load groups");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, [campusId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <LoadingState label="Forming cohort groups…" />;
  if (error) return <ErrorState text={error} onRetry={reload} />;
  if (groups.length === 0) {
    return <EmptyState icon={<HiUserGroup />} title="No groups yet" text="Groups form automatically once at least two students share a branch and year." />;
  }

  return (
    <div>
      <p className="modal-subtext" style={{ marginBottom: 16 }}>
        Formed automatically from branch + year — no one has to create or join these.
      </p>
      <div className="resource-list">
        {groups.map((group) => (
          <article className="resource-row" key={`${group.course}-${group.year}`}>
            <div className="resource-icon"><HiUserGroup /></div>
            <div>
              <b>{group.course} · {group.year}</b>
              <small>
                {group.member_count} students
                {profile?.course === group.course && profile?.year === group.year ? " · this is your cohort" : ""}
              </small>
            </div>
            <button onClick={() => setOpenGroup(group)}>
              View members <HiArrowRight />
            </button>
          </article>
        ))}
      </div>

      {openGroup && (
        <CohortMembersModal
          group={openGroup}
          campusId={campusId}
          onClose={() => setOpenGroup(null)}
          notify={notify}
        />
      )}
    </div>
  );
}

function CohortMembersModal({ group, campusId, onClose, notify }) {
  const [members, setMembers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getCohortGroupMembers({ campusId, course: group.course, year: group.year })
      .then(setMembers)
      .catch((err) => setError(err.message || "Could not load members"));
  }, [campusId, group.course, group.year]);

  return (
    <ModalShell kicker="COHORT GROUP" title={`${group.course} · ${group.year}`} onClose={onClose}>
      {error && <ErrorState text={error} />}
      {!error && !members && <LoadingState label="Loading members…" />}
      {members && members.length === 0 && <EmptyState title="No members visible" />}
      {members && members.map((m) => (
        <div key={m.id} className="resource-row">
          <div className="resource-icon">{m.name?.[0] || "?"}</div>
          <div>
            <b>{m.name}</b>
            <small>{m.department || m.course}{m.open_to_projects ? " · Open to projects" : ""}</small>
          </div>
          <button onClick={() => notify(`Connection request sent to ${m.name}`)} aria-label={`Connect with ${m.name}`}>
            <HiUserPlus />
          </button>
        </div>
      ))}
    </ModalShell>
  );
}

function ClassmateCard({ person, notify, authUser, openLogin, onOpenConversation }) {
  const [messaging, setMessaging] = useState(false);

  const messagePerson = async () => {
    if (!authUser) { openLogin?.(); notify("Sign in to send a message"); return; }
    try {
      setMessaging(true);
      const conversationId = await startConversation(person.id);
      onOpenConversation?.(conversationId);
    } catch (error) {
      notify(error.message || "Could not start a conversation");
    } finally {
      setMessaging(false);
    }
  };

  return (
    <article className="person-card">
      <div className="person-top">
        <div className="big-avatar small">{person.name?.[0] || "?"}</div>

        <div>
          <h3>{person.name}</h3>
          <p>
            {person.course} · {person.year}
          </p>
        </div>

        {person.open_to_projects && <span className="match">Open</span>}
      </div>

      {person.bio && <p className="classmate-bio">{person.bio}</p>}

      {person.achievements?.length > 0 && (
        <div className="skill-list achievements-list">
          {person.achievements.map((achievement) => (
            <span key={achievement}>
              <HiTrophy /> {achievement}
            </span>
          ))}
        </div>
      )}

      {person.skills?.length > 0 && (
        <div className="skill-list">
          {person.skills.map((skill) => (
            <span key={skill}>{skill}</span>
          ))}
        </div>
      )}

      <div className="person-actions">
        <button onClick={() => notify(`Connection request sent to ${person.name}`)}>
          <HiUserPlus /> Connect
        </button>
        <button className="ghost" disabled={messaging} onClick={messagePerson}>
          <HiChatBubbleLeftRight /> {messaging ? "Starting…" : "Message"}
        </button>
        {person.linkedin_url && (
          <a className="ghost" href={person.linkedin_url} target="_blank" rel="noreferrer">
            <FaLinkedin /> LinkedIn
          </a>
        )}
        {person.github_url && (
          <a className="ghost" href={person.github_url} target="_blank" rel="noreferrer">
            <FaGithub /> GitHub
          </a>
        )}
      </div>
    </article>
  );
}

export { ClassmateCard, CohortGroups, CohortMembersModal, Socialize, SuggestedForYou, SuggestedPersonCard };
