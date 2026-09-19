import React, { Suspense, lazy, useState } from "react";
import { LoadingState } from "../../components/ui/States";
import { startConversation } from "../../services/messagingService";
import { HiChatBubbleLeftRight, HiMagnifyingGlass, HiSparkles, HiUserPlus } from "react-icons/hi2";
import { PageHeader } from "../../components/ui/Shell";

const TeamsBoard = lazy(() => import("../teams/TeamsBoard"));

function People({ notify, people, campusId, authUser, openLogin, onOpenConversation }) {
  const [section, setSection] = useState("people"); // 'people' | 'teams'
  const [q, setQ] = useState("");

  const filtered = people.filter((person) =>
    `${person.name} ${person.skills.join(" ")}`
      .toLowerCase()
      .includes(q.toLowerCase())
  );

  return (
    <section className="page-section">
      <PageHeader
        kicker="NETWORK"
        title="Find Your People"
        text="Discover students based on skills, interests and projects, or start a team and let Campus OS find teammates who match."
        action={
          section === "people" ? (
            <button className="primary" onClick={() => setSection("teams")}>
              <HiUserPlus /> Need a teammate
            </button>
          ) : null
        }
      />

      <div className="chips" style={{ margin: "4px 0 22px", justifyContent: "flex-start" }}>
        <button className={section === "people" ? "chip active" : "chip"} onClick={() => setSection("people")}>People</button>
        <button className={section === "teams" ? "chip active" : "chip"} onClick={() => setSection("teams")}>
          <HiSparkles /> Teams
        </button>
      </div>

      {section === "people" && (
        <>
          <div className="searchbar compact wide-search">
            <HiMagnifyingGlass />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search people or skills..."
              aria-label="Search people or skills"
            />
          </div>

          <div className="people-grid">
            {filtered.map((person) => (
              <PersonCard key={person.id} person={person} notify={notify} authUser={authUser} openLogin={openLogin} onOpenConversation={onOpenConversation} />
            ))}
          </div>
        </>
      )}

      {section === "teams" && (
        <Suspense fallback={<LoadingState label="Loading teams…" />}>
          <TeamsBoard campusId={campusId} authUser={authUser} notify={notify} openLogin={openLogin} />
        </Suspense>
      )}
    </section>
  );
}

function PersonCard({ person, notify, authUser, openLogin, onOpenConversation }) {
  const [messaging, setMessaging] = useState(false);

  const messagePerson = async () => {
    if (!authUser) { openLogin?.(); notify("Sign in to send a message"); return; }
    if (person.id === authUser.id) { notify("That's you!"); return; }
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
        <div className="big-avatar small">{person.name[0]}</div>

        <div>
          <h3>{person.name}</h3>
          <p>
            {person.course} · {person.year}
          </p>
        </div>

        <span className="match">{person.match}%</span>
      </div>

      <div className="skill-list">
        {person.skills.map((skill) => (
          <span key={skill}>{skill}</span>
        ))}
      </div>

      <div className="person-actions">
        <button onClick={() => notify(`Connection request sent to ${person.name}`)}>
          <HiUserPlus /> Connect
        </button>
        <button className="ghost" disabled={messaging} onClick={messagePerson}>
          <HiChatBubbleLeftRight /> {messaging ? "Starting…" : "Message"}
        </button>
      </div>
    </article>
  );
}

export { People, PersonCard, TeamsBoard };
