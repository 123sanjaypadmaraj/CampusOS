import React, { useState } from "react";
import { EmptyState, LoadingState } from "../../components/ui/States";
import { addPostComment, getPostComments, reportContent, togglePostLike } from "../../services/mvpService";
import { HiAcademicCap, HiArrowRight, HiArrowUpTray, HiBookmark, HiChatBubbleOvalLeft, HiEllipsisHorizontal, HiHeart, HiMagnifyingGlass, HiOutlineBookmark, HiPlus, HiShieldCheck, HiUserGroup } from "react-icons/hi2";
import { CommandCard } from "../../components/ui/Shell";

function Campus({
  search,
  setSearch,
  filter,
  setFilter,
  notify,
  posts,
  postsLoading,
  openModal,
  go,
  authUser,
  setLoginOpen,
  savedPostIds = [],
  onToggleSave,
  clubs = [],
  communityStats,
}) {
  const filters = [
    "All",
    "Hackathon",
    "Event",
    "Help Needed",
    "Achievement",
    "Saved",
  ];

  return (
    <section className="page-section campus-page">
      <div className="section-head large">
        <div>
          <span className="section-kicker">COMMUNITY</span>
          <h1>Campus Feed</h1>
          <p>A verified social layer for your entire campus.</p>
        </div>

        <button className="primary" onClick={() => openModal("post")}>
          <HiPlus /> Create post
        </button>
      </div>

      <div className="feed-toolbar">
        <div className="searchbar compact">
          <HiMagnifyingGlass />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campus posts..."
            aria-label="Search campus posts"
          />
        </div>

        <div className="chips">
          {filters.map((item) => (
            <button
              className={filter === item ? "chip active" : "chip"}
              onClick={() => setFilter(item)}
              key={item}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="campus-command-grid">
        <CommandCard
          icon={<HiUserGroup />}
          title="Find People"
          text="Match skills & teams"
          onClick={() => go("people")}
        />
        <CommandCard
          icon={<HiAcademicCap />}
          title="Clubs"
          text="Explore student communities"
          onClick={() => go("clubs")}
        />
        <CommandCard
          icon={<HiUserGroup />}
          title="Connect"
          text="Classmates & achievements"
          onClick={() => go("socialize")}
        />
      </div>

      <div className="feed-layout">
        <div className="feed">
          {postsLoading && <LoadingState label="Loading campus feed…" />}

          {!postsLoading && posts.length === 0 && (
            <EmptyState
              title="No posts yet"
              text="Be the first to share something with your campus."
            />
          )}

          {!postsLoading && posts.map((post) => (
            <Post
              key={post.id}
              post={post}
              notify={notify}
              authUser={authUser}
              setLoginOpen={setLoginOpen}
              saved={savedPostIds.includes(post.id)}
              onToggleSave={onToggleSave}
            />
          ))}
        </div>

        <aside className="side-card">
          <span className="section-kicker">TRENDING</span>
          <h3>Campus topics</h3>

          {[
            "#Hackathon2026",
            "#AIWorkshop",
            "#PlacementPrep",
            "#Robotics",
            "#LostAndFound",
          ].map((item, index) => (
            <button key={item} onClick={() => notify(`${item} selected`)}>
              <b>0{index + 1}</b>
              {item}
              <span><HiArrowRight /></span>
            </button>
          ))}

          <hr />

          <span className="section-kicker">YOUR CAMPUS</span>

          <div className="mini-stat">
            <b>{communityStats ? communityStats.students.toLocaleString() : "—"}</b>
            <span>students</span>
          </div>

          <div className="mini-stat">
            <b>{communityStats ? communityStats.faculty.toLocaleString() : "—"}</b>
            <span>teachers</span>
          </div>

          <div className="mini-stat">
            <b>{clubs.length}</b>
            <span>active clubs</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Post({ post, notify, authUser, setLoginOpen, saved = false, onToggleSave }) {
  const [likes, setLikes] = useState(post.likes || 0);
  const [liked, setLiked] = useState(post.liked || false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState([]);
  const [commentText, setCommentText] = useState("");

  const handleShare = async () => {
    const url = `${window.location.origin}/campus?post=${post.id}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, url });
        return;
      } catch {
        return; // user cancelled the native share sheet -- not an error
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      notify("Link copied to clipboard");
    } catch {
      notify(url); // last-resort fallback so the link is still visible
    }
  };

  const handleLike = async () => {
    if (!authUser) {
      setLoginOpen?.();
      notify("Sign in to like posts");
      return;
    }

    try {
      const isLikedNow = await togglePostLike({ postId: post.id, userId: authUser.id });
      setLiked(isLikedNow);
      setLikes((prev) => (isLikedNow ? prev + 1 : Math.max(0, prev - 1)));
    } catch (err) {
      console.error(err);
      notify("Could not toggle like");
    }
  };

  const toggleComments = async () => {
    if (!showComments) {
      try {
        const loaded = await getPostComments(post.id);
        setComments(loaded);
      } catch (err) {
        console.error(err);
      }
    }
    setShowComments(!showComments);
  };

  const handleAddComment = async () => {
    if (!authUser) {
      setLoginOpen?.();
      notify("Sign in to comment");
      return;
    }
    if (!commentText.trim()) return;

    try {
      const added = await addPostComment({
        postId: post.id,
        userId: authUser.id,
        content: commentText,
      });
      setComments((prev) => [
        ...prev,
        {
          id: added.id,
          author: authUser.email?.split("@")[0] || "You",
          content: commentText,
          time: "Just now",
        },
      ]);
      setCommentText("");
      notify("Comment added");
    } catch (err) {
      console.error(err);
      notify("Could not post comment");
    }
  };

  return (
    <article className={`post ${post.accent}`}>
      <div className="post-head">
        <div className="avatar">{post.author ? post.author[0] : "C"}</div>

        <div>
          <b>
            {post.author}{" "}
            {post.verified && <HiShieldCheck className="verified" />}
          </b>
          <small>{post.time}</small>
        </div>

        <button
          onClick={async () => {
            if (!authUser) { setLoginOpen?.(); notify("Sign in to report a post"); return; }
            const reason = window.prompt("Why are you reporting this post? (spam, harassment, etc.)");
            if (!reason?.trim()) return;
            try {
              await reportContent("post", post.id, reason.trim());
              notify("Reported to campus moderators");
            } catch (err) {
              notify(err.message || "Could not report this post");
            }
          }}
          aria-label="Report post"
        >
          <HiEllipsisHorizontal />
        </button>
      </div>

      <div className="post-type">
        <span>{post.icon}</span>
        {post.type}
      </div>

      <h3>{post.title}</h3>

      {post.images?.length > 0 && (
        <div className="post-images" style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "8px 0" }}>
          {post.images.map((url) => (
            <img key={url} src={url} alt="" style={{ maxWidth: "100%", maxHeight: 320, borderRadius: 10, objectFit: "cover" }} />
          ))}
        </div>
      )}

      <div className="tags">
        {post.tags.map((tag) => (
          <span key={tag}>#{tag}</span>
        ))}
      </div>

      <div className="post-actions">
        <button onClick={handleLike} className={liked ? "liked" : ""}>
          <HiHeart style={{ color: liked ? "#ef4444" : "inherit" }} /> {likes}
        </button>
        <button onClick={toggleComments}>
          <HiChatBubbleOvalLeft /> {post.comments + comments.length}
        </button>
        <button onClick={handleShare}>
          <HiArrowUpTray /> Share
        </button>
        <button
          onClick={() => {
            if (!authUser) { setLoginOpen?.(); notify("Sign in to save posts"); return; }
            onToggleSave?.(post.id);
          }}
        >
          {saved ? <HiBookmark style={{ color: "#f59e0b" }} /> : <HiOutlineBookmark />} {saved ? "Saved" : "Save"}
        </button>
      </div>

      {showComments && (
        <div className="comments-section" style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.1)" }}>
          {comments.map((c) => (
            <div key={c.id} style={{ marginBottom: "8px", fontSize: "0.9rem" }}>
              <b>{c.author}: </b>
              <span>{c.content}</span>
            </div>
          ))}
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <input
              type="text"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              aria-label="Add a comment"
              style={{ flex: 1, padding: "6px 12px", borderRadius: "6px" }}
            />
            <button className="primary" onClick={handleAddComment}>
              Post
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export { Campus, Post };
