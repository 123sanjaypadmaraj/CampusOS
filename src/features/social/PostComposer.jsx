import React, { useState } from "react";
import { uploadPostImage } from "../../services/mvpService";
import { HiArrowUpTray } from "react-icons/hi2";
import { ModalShell } from "../../components/ui/Shell";

function PostComposer({ onClose, onCreate, user, authUser, notify }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState("General");
  const [tag, setTag] = useState("");
  const [tags, setTags] = useState([]);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);

  const addTag = () => {
    const clean = tag.trim().toLowerCase();
    if (clean && !tags.includes(clean)) setTags((prev) => [...prev, clean]);
    setTag("");
  };

  const handleImagePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (images.length >= 4) {
      notify?.("You can attach up to 4 images per post");
      return;
    }
    if (!authUser?.id) {
      notify?.("Sign in to attach images");
      return;
    }
    try {
      setUploading(true);
      const url = await uploadPostImage(file, authUser.id);
      setImages((prev) => [...prev, url]);
    } catch (err) {
      notify?.(err.message || "Could not upload that image");
    } finally {
      setUploading(false);
    }
  };

  return (
    <ModalShell
      kicker="CAMPUS COMMUNITY"
      title="Create a post"
      onClose={onClose}
    >
      <label>
        Post type
        <select value={type} onChange={(e) => setType(e.target.value)}>
          <option>General</option>
          <option>Hackathon</option>
          <option>Event</option>
          <option>Help Needed</option>
          <option>Achievement</option>
        </select>
      </label>

      <label>
        What do you want to say?
        <textarea
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Share something with your campus..."
        />
      </label>

      <label>
        Tags
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
            placeholder="e.g. robotics — press Enter to add"
          />
          <button type="button" onClick={addTag} disabled={!tag.trim()}>Add</button>
        </div>
      </label>
      {tags.length > 0 && (
        <div className="chips">
          {tags.map((t) => (
            <button key={t} className="chip" onClick={() => setTags((prev) => prev.filter((x) => x !== t))} title="Remove tag">
              #{t} ×
            </button>
          ))}
        </div>
      )}

      <label>
        Photos ({images.length}/4)
        <input type="file" accept="image/*" onChange={handleImagePick} disabled={uploading || images.length >= 4} />
      </label>
      {images.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {images.map((url) => (
            <div key={url} style={{ position: "relative" }}>
              <img src={url} alt="" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }} />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((x) => x !== url))}
                style={{ position: "absolute", top: -6, right: -6, borderRadius: "50%", width: 20, height: 20, lineHeight: "20px", padding: 0 }}
                title="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        className="primary wide"
        disabled={!title.trim() || uploading}
        onClick={() =>
          onCreate({
            type,
            title,
            author: user?.name || "Campus Student",
            accent: "violet",
            tags,
            images,
          })
        }
      >
        {uploading ? "Uploading…" : <>Publish <HiArrowUpTray /></>}
      </button>
    </ModalShell>
  );
}

export { PostComposer };
