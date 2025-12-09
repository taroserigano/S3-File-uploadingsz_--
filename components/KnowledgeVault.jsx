"use client";

import { useCallback, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import TravelAgent from "./TravelAgent";
import {
  getChatSessions,
  createChatSession,
  updateChatSession,
  deleteChatSession,
} from "@/utils/actions";

const statusStyles = {
  PROCESSING: "badge-warning",
  PROCESSED: "badge-success",
  FAILED: "badge-error",
};

const KnowledgeVault = ({ userId, initialDocuments }) => {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const [chatQuery, setChatQuery] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [followUpQuestions, setFollowUpQuestions] = useState([]);

  // Tab state
  const [activeTab, setActiveTab] = useState("travel");
  const [deletingId, setDeletingId] = useState(null);

  // Chat sessions
  const [chatSessions, setChatSessions] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [showSessions, setShowSessions] = useState(false);
  const [sessionTitle, setSessionTitle] = useState("New Chat");
  const [isEditingTitle, setIsEditingTitle] = useState(false);

  // Document preview modal
  const [previewDocument, setPreviewDocument] = useState(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewContent, setPreviewContent] = useState(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  // Load chat sessions on mount
  useEffect(() => {
    if (userId && activeTab === "chat") {
      loadChatSessions();
    }
  }, [userId, activeTab]);

  const loadChatSessions = async () => {
    try {
      const sessions = await getChatSessions(userId);
      setChatSessions(sessions);
    } catch (error) {
      console.error("Failed to load chat sessions:", error);
    }
  };

  const handleNewSession = async () => {
    try {
      const session = await createChatSession(userId, "New Chat");
      setChatMessages([]);
      setFollowUpQuestions([]);
      setCurrentSessionId(session.id);
      setSessionTitle(session.title);
      setChatSessions([session, ...chatSessions]);
      toast.success("New chat session started");
    } catch (error) {
      toast.error("Failed to create new session");
    }
  };

  const handleLoadSession = async (session) => {
    try {
      setCurrentSessionId(session.id);
      setSessionTitle(session.title);
      setChatMessages(session.messages || []);
      setFollowUpQuestions([]);
      setShowSessions(false);
      toast.success(`Loaded: ${session.title}`);
    } catch (error) {
      toast.error("Failed to load session");
    }
  };

  const handleDeleteSession = async (sessionId) => {
    if (!confirm("Delete this chat session?")) return;
    try {
      await deleteChatSession(sessionId);
      setChatSessions(chatSessions.filter((s) => s.id !== sessionId));
      if (currentSessionId === sessionId) {
        setChatMessages([]);
        setCurrentSessionId(null);
        setSessionTitle("New Chat");
      }
      toast.success("Session deleted");
    } catch (error) {
      toast.error("Failed to delete session");
    }
  };

  const handleSaveSession = async () => {
    if (!currentSessionId || chatMessages.length === 0) {
      toast.error("No active session to save");
      return;
    }
    try {
      await updateChatSession(currentSessionId, {
        messages: chatMessages,
        title: sessionTitle,
        updatedAt: new Date(),
      });
      await loadChatSessions();
      toast.success("Session saved");
    } catch (error) {
      toast.error("Failed to save session");
    }
  };

  const handleUpdateTitle = async () => {
    if (!currentSessionId) return;
    try {
      await updateChatSession(currentSessionId, { title: sessionTitle });
      await loadChatSessions();
      setIsEditingTitle(false);
      toast.success("Title updated");
    } catch (error) {
      toast.error("Failed to update title");
    }
  };

  const refreshDocuments = useCallback(async () => {
    const response = await fetch("/api/vault/documents", { cache: "no-store" });
    const payload = await response.json();
    setDocuments(payload.documents || []);
    router.refresh();
  }, [router]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!file) {
      toast.error("Please select a file to ingest.");
      return;
    }

    try {
      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", file);
      if (title) formData.append("title", title);
      if (notes) formData.append("notes", notes);

      const response = await fetch("/api/vault/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.detail || payload?.error || "Upload failed.");
      }

      toast.success("Document ingested successfully.");
      setFile(null);
      setTitle("");
      setNotes("");
      await refreshDocuments();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleChatSubmit = async (event, customQuery = null) => {
    event?.preventDefault();
    const trimmedQuery = (customQuery || chatQuery).trim();
    if (!trimmedQuery) {
      return;
    }

    // Create or ensure we have a session
    if (!currentSessionId) {
      const session = await createChatSession(userId, "New Chat");
      setCurrentSessionId(session.id);
      setSessionTitle(session.title);
      setChatSessions([session, ...chatSessions]);
    }

    const userMessage = { role: "user", content: trimmedQuery };
    setChatMessages((prev) => [...prev, userMessage]);
    setChatQuery("");
    setIsQuerying(true);
    setFollowUpQuestions([]);

    const assistantMessageIndex = chatMessages.length + 1;
    const assistantMessage = {
      role: "assistant",
      content: "",
      citations: [],
      chunks: [],
      isStreaming: true,
    };
    setChatMessages((prev) => [...prev, assistantMessage]);

    try {
      const response = await fetch("/api/vault/query-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmedQuery, top_k: 3 }),
      });

      if (!response.ok) {
        throw new Error("Streaming query failed.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) {
            continue;
          }

          const payload = line.slice(6).trim();
          if (!payload) {
            continue;
          }

          try {
            const event = JSON.parse(payload);

            if (event.type === "citations") {
              setChatMessages((prev) => {
                const updated = [...prev];
                updated[assistantMessageIndex] = {
                  ...updated[assistantMessageIndex],
                  citations: event.content,
                };
                return updated;
              });
            } else if (event.type === "token") {
              setChatMessages((prev) => {
                const updated = [...prev];
                updated[assistantMessageIndex] = {
                  ...updated[assistantMessageIndex],
                  content:
                    updated[assistantMessageIndex].content + event.content,
                };
                return updated;
              });
            } else if (event.type === "done") {
              setChatMessages((prev) => {
                const updated = [...prev];
                updated[assistantMessageIndex] = {
                  ...updated[assistantMessageIndex],
                  isStreaming: false,
                };
                return updated;
              });
              // Generate follow-up questions
              generateFollowUpQuestions(
                trimmedQuery,
                chatMessages[assistantMessageIndex]?.content || ""
              );
            } else if (event.type === "error") {
              throw new Error(event.content);
            }
          } catch (parseError) {
            console.error("Failed to parse SSE event:", parseError);
          }
        }
      }
    } catch (error) {
      toast.error(error.message);
      setChatMessages((prev) => {
        const updated = [...prev];
        updated[assistantMessageIndex] = {
          role: "assistant",
          content: `Error: ${error.message}`,
          citations: [],
          isStreaming: false,
        };
        return updated;
      });
    } finally {
      setIsQuerying(false);
    }
  };

  const generateFollowUpQuestions = async (userQuery, assistantResponse) => {
    try {
      const response = await fetch("/api/vault/generate-followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userQuery, answer: assistantResponse }),
      });

      if (response.ok) {
        const data = await response.json();
        setFollowUpQuestions(data.questions || []);
      }
    } catch (error) {
      console.error("Failed to generate follow-up questions:", error);
    }
  };

  const handleFollowUpClick = (question) => {
    setChatQuery(question);
    setFollowUpQuestions([]);
  };

  const handlePreviewDocument = async (doc) => {
    try {
      setPreviewDocument(doc);
      setShowPreviewModal(true);
      setPreviewContent(null);
      setPreviewError(null);
      setIsLoadingPreview(true);

      // Fetch document content with cache busting
      const cacheBuster = `t=${Date.now()}`;
      const response = await fetch(`/api/vault/documents/${doc.id}/preview?${cacheBuster}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to load document preview");
      }

      const data = await response.json();
      console.log('Preview data received:', data); // Debug log
      setPreviewContent(data.content);
    } catch (error) {
      console.error("Preview error:", error);
      setPreviewError(error.message);
      toast.error("Failed to load document preview");
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const formatDate = (date) => new Date(date).toLocaleString();
  const obfuscatedUserId = userId ? `${userId.slice(0, 6)}...` : "anonymous";

  const handleDelete = async (documentId) => {
    if (
      !confirm(
        "Are you sure you want to delete this document? This action cannot be undone."
      )
    ) {
      return;
    }

    try {
      setDeletingId(documentId);
      const response = await fetch(`/api/vault/documents/${documentId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error || "Failed to delete document");
      }

      toast.success("Document deleted successfully");
      await refreshDocuments();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Personal Knowledge Vault</h1>
        <p className="text-sm text-base-content/70">
          Upload documents, chat with AI, and manage your travel knowledge base
        </p>
        <p className="text-xs text-base-content/60 mt-1">
          Securely linked to{" "}
          <span className="font-mono">{obfuscatedUserId}</span>
        </p>
      </div>

      {/* Tabs */}
      <div className="card bg-base-100 shadow-xl">
        <div className="card-body p-0">
          {/* Tab Navigation */}
          <div className="tabs tabs-boxed bg-base-200 p-2">
            <a
              className={`tab tab-lg ${
                activeTab === "travel" ? "tab-active" : ""
              }`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab("travel");
              }}
            >
              ✈️ Travel Agent
            </a>
            <a
              className={`tab tab-lg ${
                activeTab === "chat" ? "tab-active" : ""
              }`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab("chat");
              }}
            >
              💬 Chat
              {chatMessages.length > 0 && (
                <span className="badge badge-sm ml-2">
                  {chatMessages.length}
                </span>
              )}
            </a>
            <a
              className={`tab tab-lg ${
                activeTab === "upload" ? "tab-active" : ""
              }`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab("upload");
              }}
            >
              📤 Upload
            </a>
            <a
              className={`tab tab-lg ${
                activeTab === "library" ? "tab-active" : ""
              }`}
              onClick={(e) => {
                e.preventDefault();
                setActiveTab("library");
              }}
            >
              📚 Library
              {documents.length > 0 && (
                <span className="badge badge-sm ml-2">{documents.length}</span>
              )}
            </a>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {/* Travel Agent Tab */}
            {activeTab === "travel" && <TravelAgent userId={userId} />}

            {/* Chat Tab */}
            {activeTab === "chat" && (
              <div className="space-y-6">
                {/* Session Controls */}
                <div className="flex items-center gap-2 flex-wrap">
                  {isEditingTitle ? (
                    <div className="flex items-center gap-2 flex-1">
                      <input
                        type="text"
                        className="input input-sm input-bordered flex-1"
                        value={sessionTitle}
                        onChange={(e) => setSessionTitle(e.target.value)}
                        onBlur={handleUpdateTitle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleUpdateTitle();
                        }}
                        autoFocus
                      />
                      <button
                        className="btn btn-sm btn-ghost"
                        onClick={handleUpdateTitle}
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setIsEditingTitle(true)}
                    >
                      📝 {sessionTitle}
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={handleNewSession}
                  >
                    ➕ New
                  </button>
                  <button
                    className="btn btn-sm btn-secondary"
                    onClick={handleSaveSession}
                    disabled={!currentSessionId || chatMessages.length === 0}
                  >
                    💾 Save
                  </button>
                  <button
                    className="btn btn-sm btn-accent"
                    onClick={() => setShowSessions(!showSessions)}
                  >
                    📚 History ({chatSessions.length})
                  </button>
                </div>

                {/* Session History Dropdown */}
                {showSessions && chatSessions.length > 0 && (
                  <div className="bg-base-200 rounded-lg p-4 max-h-64 overflow-y-auto">
                    <h3 className="font-semibold mb-2">Chat History</h3>
                    <div className="space-y-2">
                      {chatSessions.map((session) => (
                        <div
                          key={session.id}
                          className={`flex items-center justify-between p-2 rounded ${
                            currentSessionId === session.id
                              ? "bg-primary/20"
                              : "bg-base-100"
                          }`}
                        >
                          <button
                            className="flex-1 text-left"
                            onClick={() => handleLoadSession(session)}
                          >
                            <p className="font-medium">{session.title}</p>
                            <p className="text-xs text-base-content/60">
                              {new Date(session.updatedAt).toLocaleString()}
                            </p>
                          </button>
                          <button
                            className="btn btn-xs btn-ghost"
                            onClick={() => handleDeleteSession(session.id)}
                          >
                            🗑️
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="alert alert-info">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    className="stroke-current shrink-0 w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    ></path>
                  </svg>
                  <span>
                    Ask questions about your uploaded documents using AI-powered
                    retrieval
                  </span>
                </div>

                {/* Chat messages */}
                <div className="space-y-4 max-h-96 overflow-y-auto bg-base-200 rounded-lg p-4">
                  {chatMessages.length === 0 ? (
                    <div className="text-center text-base-content/50 py-12">
                      <p className="text-lg mb-2">💬 Start a conversation</p>
                      <p className="text-sm">
                        Try: &ldquo;What are the best attractions in
                        Tokyo?&rdquo;
                      </p>
                    </div>
                  ) : (
                    chatMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`chat ${
                          msg.role === "user" ? "chat-end" : "chat-start"
                        }`}
                      >
                        <div className="chat-bubble">
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                          {msg.isStreaming && (
                            <span className="inline-block w-2 h-4 ml-1 bg-current animate-pulse"></span>
                          )}
                          {msg.citations && msg.citations.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-base-content/20">
                              <p className="text-xs font-semibold">Sources:</p>
                              <ul className="text-xs space-y-1 mt-1">
                                {msg.citations.map((citation, cidx) => (
                                  <li key={cidx}>📄 {citation.title}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  {isQuerying &&
                    chatMessages[chatMessages.length - 1]?.role !==
                      "assistant" && (
                      <div className="chat chat-start">
                        <div className="chat-bubble">
                          <span className="loading loading-dots loading-sm"></span>
                        </div>
                      </div>
                    )}
                </div>

                {/* Follow-up suggestions */}
                {followUpQuestions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-semibold text-base-content/70">
                      💡 Suggested follow-ups:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {followUpQuestions.map((q, idx) => (
                        <button
                          key={idx}
                          className="btn btn-sm btn-outline"
                          onClick={() => handleFollowUpClick(q)}
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Chat input */}
                <form onSubmit={handleChatSubmit} className="flex gap-2">
                  <input
                    type="text"
                    className="input input-bordered flex-1"
                    placeholder="Ask about your documents..."
                    value={chatQuery}
                    onChange={(e) => setChatQuery(e.target.value)}
                    disabled={isQuerying}
                  />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={isQuerying || !chatQuery.trim()}
                  >
                    {isQuerying ? "Thinking..." : "Ask"}
                  </button>
                </form>
              </div>
            )}

            {/* Upload Tab */}
            {activeTab === "upload" && (
              <div className="space-y-6">
                <div className="alert alert-info">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    className="stroke-current shrink-0 w-6 h-6"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    ></path>
                  </svg>
                  <span>
                    Upload PDFs, DOCX, or text files. They&apos;ll be chunked,
                    embedded, and stored in your FAISS index.
                  </span>
                </div>

                <form className="space-y-6" onSubmit={handleSubmit}>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-semibold">
                          Document Title
                        </span>
                      </label>
                      <input
                        type="text"
                        className="input input-bordered"
                        placeholder="e.g., Tokyo Travel Guide 2024"
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                      />
                    </div>
                    <div className="form-control">
                      <label className="label">
                        <span className="label-text font-semibold">
                          Select File
                        </span>
                      </label>
                      <input
                        type="file"
                        accept=".pdf,.txt,.md,.docx"
                        className="file-input file-input-bordered"
                        onChange={(event) =>
                          setFile(event.target.files?.[0] ?? null)
                        }
                      />
                    </div>
                  </div>

                  <div className="form-control">
                    <label className="label">
                      <span className="label-text font-semibold">
                        Notes (Optional)
                      </span>
                    </label>
                    <textarea
                      className="textarea textarea-bordered h-24"
                      placeholder="Add context or tags for better organization..."
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                    />
                  </div>

                  <button
                    type="submit"
                    className="btn btn-primary btn-lg w-full"
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <>
                        <span className="loading loading-spinner"></span>
                        Uploading...
                      </>
                    ) : (
                      <>📤 Upload to Vault</>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* Library Tab */}
            {activeTab === "library" && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="alert alert-info flex-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      className="stroke-current shrink-0 w-6 h-6"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      ></path>
                    </svg>
                    <span>View and manage all your uploaded documents</span>
                  </div>
                </div>

                {documents.length === 0 ? (
                  <div className="text-center py-12 text-base-content/50">
                    <p className="text-lg mb-2">📚 No documents yet</p>
                    <p className="text-sm mb-4">
                      Upload your first document to get started
                    </p>
                    <button
                      className="btn btn-primary"
                      onClick={() => setActiveTab("upload")}
                    >
                      Go to Upload
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table table-zebra">
                      <thead>
                        <tr>
                          <th>Title</th>
                          <th>Status</th>
                          <th>Chunks</th>
                          <th>Tokens</th>
                          <th>Uploaded</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.map((doc) => (
                          <tr key={doc.id}>
                            <td>
                              <div>
                                <p className="font-semibold">{doc.title}</p>
                                <p className="text-xs text-base-content/70">
                                  {doc.filename}
                                </p>
                              </div>
                            </td>
                            <td>
                              <span
                                className={`badge ${
                                  statusStyles[doc.status] || "badge-ghost"
                                }`}
                              >
                                {doc.status.toLowerCase()}
                              </span>
                            </td>
                            <td>
                              <span className="badge badge-outline">
                                {doc.chunkCount}
                              </span>
                            </td>
                            <td>
                              <span className="badge badge-outline">
                                {doc.tokenEstimate}
                              </span>
                            </td>
                            <td className="text-xs">
                              {formatDate(doc.createdAt)}
                            </td>
                            <td>
                              <div className="flex gap-2">
                                <button
                                  className="btn btn-info btn-sm"
                                  onClick={() => handlePreviewDocument(doc)}
                                >
                                  👁️ Preview
                                </button>
                                <button
                                  className="btn btn-error btn-sm"
                                  onClick={() => handleDelete(doc.id)}
                                  disabled={deletingId === doc.id}
                                >
                                  {deletingId === doc.id ? (
                                    <span className="loading loading-spinner loading-xs"></span>
                                  ) : (
                                    "🗑️ Delete"
                                  )}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Document Preview Modal */}
      {showPreviewModal && previewDocument && (
        <div className="modal modal-open">
          <div className="modal-box w-11/12 max-w-6xl h-[95vh] flex flex-col p-6">
            <h3 className="font-bold text-lg mb-4 flex-shrink-0">
              📄 {previewDocument.title}
            </h3>

            <div className="flex-1 flex flex-col gap-4 overflow-y-auto min-h-0">
              {/* Document Metadata */}
              <div className="bg-base-200 rounded-lg p-4 flex-shrink-0">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="font-semibold">Filename:</span>{" "}
                    {previewDocument.filename}
                  </div>
                  <div>
                    <span className="font-semibold">Status:</span>{" "}
                    <span
                      className={`badge ${
                        statusStyles[previewDocument.status] || "badge-ghost"
                      }`}
                    >
                      {previewDocument.status.toLowerCase()}
                    </span>
                  </div>
                  <div>
                    <span className="font-semibold">Size:</span>{" "}
                    {(previewDocument.size / 1024).toFixed(2)} KB
                  </div>
                  <div>
                    <span className="font-semibold">Chunks:</span>{" "}
                    {previewDocument.chunkCount}
                  </div>
                  <div>
                    <span className="font-semibold">Tokens:</span>{" "}
                    {previewDocument.tokenEstimate}
                  </div>
                  <div>
                    <span className="font-semibold">Uploaded:</span>{" "}
                    {formatDate(previewDocument.createdAt)}
                  </div>
                </div>
                {previewDocument.notes && (
                  <div className="mt-4">
                    <span className="font-semibold">Notes:</span>
                    <p className="mt-1 text-sm">{previewDocument.notes}</p>
                  </div>
                )}
                {previewDocument.sourceUrl && (
                  <div className="mt-2">
                    <span className="font-semibold">Source URL:</span>{" "}
                    <a
                      href={previewDocument.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link link-primary text-sm"
                    >
                      {previewDocument.sourceUrl}
                    </a>
                  </div>
                )}
              </div>

              {/* Document Content Preview */}
              <div className="bg-base-100 border border-base-300 rounded-lg p-4 flex-shrink-0">
                <h4 className="font-semibold mb-3">Document Content:</h4>
                {isLoadingPreview ? (
                  <div className="flex items-center justify-center py-8">
                    <span className="loading loading-spinner loading-lg"></span>
                    <span className="ml-2">Loading document...</span>
                  </div>
                ) : previewError ? (
                  <div className="alert alert-error">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="stroke-current shrink-0 h-6 w-6"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span>{previewError}</span>
                  </div>
                ) : previewContent ? (
                  <div className="bg-base-200/70 border rounded p-4 max-h-[50vh] overflow-auto">
                    <pre className="whitespace-pre-wrap text-sm font-mono">
                      {previewContent}
                    </pre>
                  </div>
                ) : (
                  <div className="text-center text-base-content/50 py-8">
                    <p>No content available</p>
                  </div>
                )}
              </div>

              {/* Document Stats */}
              <div className="stats stats-vertical lg:stats-horizontal shadow w-full flex-shrink-0">
                <div className="stat">
                  <div className="stat-title">Total Chunks</div>
                  <div className="stat-value text-primary">
                    {previewDocument.chunkCount}
                  </div>
                  <div className="stat-desc">Searchable segments</div>
                </div>
                <div className="stat">
                  <div className="stat-title">Est. Tokens</div>
                  <div className="stat-value text-secondary">
                    {previewDocument.tokenEstimate}
                  </div>
                  <div className="stat-desc">Approx. word count</div>
                </div>
                <div className="stat">
                  <div className="stat-title">Status</div>
                  <div className="stat-value text-accent">
                    {previewDocument.status === "PROCESSED" ? "✓" : "⏳"}
                  </div>
                  <div className="stat-desc">
                    {previewDocument.status.toLowerCase()}
                  </div>
                </div>
              </div>

              {previewDocument.error && (
                <div className="alert alert-error">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="stroke-current shrink-0 h-6 w-6"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span>Error: {previewDocument.error}</span>
                </div>
              )}
            </div>

            <div className="modal-action flex-shrink-0 mt-4">
              <button
                className="btn"
                onClick={() => {
                  setShowPreviewModal(false);
                  setPreviewDocument(null);
                  setPreviewContent(null);
                  setPreviewError(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default KnowledgeVault;
