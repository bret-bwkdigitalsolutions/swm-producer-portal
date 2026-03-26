"use client";

import { useSession, signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function Header() {
  const { data: session } = useSession();

  const initials =
    session?.user?.name
      ?.split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase() ?? "?";

  return (
    <header className="flex h-14 items-center justify-between border-b bg-white px-6">
      <h1 className="text-lg font-semibold">SWM Producer Portal</h1>
      <DropdownMenu>
        <DropdownMenuTrigger className="relative h-8 w-8 rounded-full focus:outline-none">
          <Avatar className="h-8 w-8">
            <AvatarImage src={session?.user?.image ?? undefined} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="font-medium" onSelect={() => {}}>
            {session?.user?.name}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-muted-foreground text-xs"
            onSelect={() => {}}
          >
            {session?.user?.email}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => signOut({ callbackUrl: "/login" })}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
