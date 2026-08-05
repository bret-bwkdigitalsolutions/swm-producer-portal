"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2Icon } from "lucide-react";
import { postTeamAction } from "../actions";
import type { ContextType } from "@/lib/chat/types";

export function TeamComposer() {
  const [state, action, pending] = useActionState(postTeamAction, {});
  const [contextType, setContextType] = useState<ContextType>("global");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Post as Team</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          action={(fd) => {
            fd.set("context_type", contextType);
            action(fd);
          }}
          className="space-y-3"
        >
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Context</Label>
              <Select
                value={contextType}
                onValueChange={(v) => setContextType((v as ContextType) ?? "global")}
              >
                <SelectTrigger className="h-9 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global (All)</SelectItem>
                  <SelectItem value="show">Show</SelectItem>
                  <SelectItem value="episode">Episode</SelectItem>
                  <SelectItem value="appearance">Appearance</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {contextType !== "global" && (
              <div className="space-y-1">
                <Label htmlFor="ctx-id" className="text-xs">
                  {contextType} post ID
                </Label>
                <Input
                  id="ctx-id"
                  name="context_id"
                  type="number"
                  min={1}
                  placeholder="e.g. 812"
                  className="h-9 w-32"
                />
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="team-author" className="text-xs">
                Posted as
              </Label>
              <Input
                id="team-author"
                name="author_name"
                placeholder="Team"
                defaultValue="SWM Team"
                className="h-9 w-40"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="team-body" className="text-xs">
              Message
            </Label>
            <Textarea
              id="team-body"
              name="body"
              rows={3}
              placeholder="An official message from the team…"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                "Post message"
              )}
            </Button>
            {state.message && (
              <span
                className={`text-sm ${state.success ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
              >
                {state.message}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
