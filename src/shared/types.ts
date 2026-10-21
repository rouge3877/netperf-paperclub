export interface Paper {
  id: string;
  title: string;
  abstract: string;
  authors: string[];
  conference: string;
  year: number;
  url: string;
}
export interface Topic {
  id: string;
  name: string;
}
export interface User {
  id: string;
  username: string;
  displayName: string;
}
export interface SessionUser extends User {
  role: "member" | "admin";
  mustChangePassword: boolean;
}
export interface AdminUser extends User {
  role: SessionUser["role"];
  disabled: boolean;
  revision: number;
  createdAt: number;
}
export interface AdminUsers {
  users: AdminUser[];
  total: number;
}
export interface PaperView extends Paper {
  topics: Topic[];
  topicRevision: number;
  rating: number | null;
  ratingCount: number;
  myRating: number | null;
  available: boolean;
}
export interface Folder {
  id: string;
  name: string;
  description: string;
  ordered: boolean;
  visibility: "private" | "public";
  owner: User;
  revision: number;
  createdAt: number;
  updatedAt: number;
  paperCount: number;
  stars: number;
  starred: boolean;
  canEdit: boolean;
  isOwner: boolean;
  forkedFrom: { id: string; name: string; owner: string } | null;
}
export interface Progress {
  completed: string[];
  currentPaperId: string | null;
}
export interface FolderDetail extends Folder {
  papers: FolderPaper[];
  collaborators: User[];
  progress: Progress | null;
}
export interface FolderPaper extends PaperView {
  note: string;
}
export interface Comment {
  id: string;
  author: User;
  body: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  canEdit: boolean;
}
export interface PaperComment extends Comment {
  paper: Pick<Paper, "id" | "title" | "conference" | "year">;
}
export interface Proposal {
  id: string;
  paperId: string;
  paperTitle: string;
  author: User;
  before: Topic[];
  after: Topic[];
  reason: string;
  status: "open" | "adopted" | "superseded";
  createdAt: number;
  yes: number;
  no: number;
  users: number;
  required: number;
  myVote: "yes" | "no" | null;
  adoptedUsers: number | null;
  adoptedYes: number | null;
}
export type CommunityActivity =
  | { type: "comment"; comment: PaperComment }
  | { type: "proposal"; proposal: Proposal };
export interface CommunityFeed {
  items: CommunityActivity[];
  total: number;
  offset: number;
}
export type PaperOrder =
  "oldest" | "newest" | "title" | "conference" | "rating" | "random";
export function sortPapers(
  papers: PaperView[],
  order: PaperOrder,
  seed = 1,
): PaperView[] {
  const tie = (a: PaperView, b: PaperView) =>
    a.title.localeCompare(b.title, "en") || a.id.localeCompare(b.id);
  const hash = (id: string) => {
    let x = seed | 0;
    for (const c of id) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
    return x >>> 0;
  };
  return [...papers].sort((a, b) => {
    switch (order) {
      case "oldest":
        return a.year - b.year || tie(a, b);
      case "newest":
        return b.year - a.year || tie(a, b);
      case "conference":
        return (
          a.conference.localeCompare(b.conference) ||
          a.year - b.year ||
          tie(a, b)
        );
      case "rating":
        return (
          (b.rating ?? -1) - (a.rating ?? -1) ||
          b.ratingCount - a.ratingCount ||
          tie(a, b)
        );
      case "random":
        return hash(a.id) - hash(b.id) || tie(a, b);
      default:
        return tie(a, b);
    }
  });
}
