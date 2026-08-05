import { ChatTabs } from "./chat-tabs";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Chat</h2>
        <p className="text-sm text-muted-foreground">
          Moderate the community chat and answer member messages. Data is live
          from the membership site — nothing is stored here.
        </p>
      </div>
      <ChatTabs />
      {children}
    </div>
  );
}
