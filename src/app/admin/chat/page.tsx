import { redirect } from "next/navigation";

export default function ChatIndexPage() {
  redirect("/admin/chat/moderation");
}
