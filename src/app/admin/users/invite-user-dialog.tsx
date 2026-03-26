"use client";

import { inviteUser } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";

export function InviteUserDialog() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState("producer");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>Invite User</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite New User</DialogTitle>
          <DialogDescription>
            Create a new user account with a temporary password. The user can
            sign in with these credentials or use Google OAuth.
          </DialogDescription>
        </DialogHeader>

        <form
          action={async (formData) => {
            formData.set("role", role);
            await inviteUser(formData);
            setOpen(false);
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="invite-name">Name</Label>
            <Input id="invite-name" name="name" required placeholder="Full name" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              name="email"
              type="email"
              required
              placeholder="user@example.com"
            />
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={(val: string | null) => setRole(val ?? "producer")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="producer">Producer</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-password">Temporary Password</Label>
            <Input
              id="invite-password"
              name="tempPassword"
              type="password"
              required
              placeholder="Temporary password"
              minLength={8}
            />
          </div>

          <DialogFooter>
            <Button type="submit">Create User</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
