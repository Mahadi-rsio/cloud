"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import {
  getApplication,
  type Application,
  type Machine,
} from "@/lib/applications";
import { extractErrorMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusBadge } from "./status-badge";
import { formatDate, formatRegion } from "./format";
import { EditApplicationDialog } from "./edit-application-dialog";
import { DeleteApplicationDialog } from "./delete-application-dialog";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium text-foreground">
        {value}
      </span>
    </div>
  );
}

export function ApplicationDetail({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<{
    application: Application;
    machines: Machine[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = async () => {
    try {
      setError(null);
      setIsLoading(true);
      setData(await getApplication(id));
    } catch (loadError) {
      setError(extractErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const application = data?.application;
  const machines = data?.machines ?? [];

  return (
    <div className="flex flex-col gap-6">
      <a
        href="/apps"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Apps
      </a>

      {isLoading && !data ? (
        <Card>
          <CardContent>
            <p className="py-6 text-center text-sm text-muted-foreground">
              Loading app…
            </p>
          </CardContent>
        </Card>
      ) : error && !data ? (
        <Card>
          <CardContent>
            <p
              role="alert"
              className="text-sm text-destructive-foreground bg-destructive/10 rounded-md px-3 py-2"
            >
              {error}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-3"
              onClick={() => void load()}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : application ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{application.name}</CardTitle>
              <CardDescription>{application.slug}</CardDescription>
              <CardAction>
                <div className="flex items-center gap-2">
                  <StatusBadge status={application.status} />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditOpen(true)}
                  >
                    <Pencil />
                    Edit
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => setDeleteOpen(true)}
                  >
                    <Trash2 />
                    Delete
                  </Button>
                </div>
              </CardAction>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 border-t pt-4">
                <DetailRow label="Status" value={application.status} />
                <DetailRow label="Region" value={formatRegion(application.region)} />
                <DetailRow
                  label="Image"
                  value={application.runtime?.image ?? "—"}
                />
                <DetailRow
                  label="CPUs"
                  value={
                    application.runtime?.guest?.cpus
                      ? String(application.runtime.guest.cpus)
                      : "—"
                  }
                />
                <DetailRow
                  label="Memory"
                  value={
                    application.runtime?.guest?.memory_mb
                      ? `${application.runtime.guest.memory_mb} MB`
                      : "—"
                  }
                />
                <DetailRow
                  label="Internal port"
                  value={
                    application.runtime?.internalPort
                      ? String(application.runtime.internalPort)
                      : "—"
                  }
                />
                <DetailRow
                  label="Created"
                  value={formatDate(application.createdAt)}
                />
                <DetailRow
                  label="Last updated"
                  value={formatDate(application.updatedAt)}
                />
                <DetailRow
                  label="Last operation"
                  value={formatDate(application.lastOperationAt)}
                />
                {application.runtime?.env && (
                  <div className="flex flex-col gap-1.5 pt-1">
                    <span className="text-sm text-muted-foreground">
                      Environment
                    </span>
                    <pre className="overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs text-foreground">
                      {JSON.stringify(application.runtime.env, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Machines</CardTitle>
              <CardDescription>
                Machines provisioned for this app.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {machines.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No machines yet.
                </p>
              ) : (
                machines.map((machine) => (
                  <div
                    key={machine.id}
                    className="flex items-center justify-between gap-4 rounded-lg border bg-card px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {machine.flyMachineId ?? "Machine"}
                        </p>
                        <StatusBadge status={machine.status} />
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {formatRegion(machine.region)} · Instance{" "}
                        {machine.instanceNumber + 1}
                        {machine.sharedIpv4 ? ` · ${machine.sharedIpv4}` : ""}
                      </p>
                    </div>
                    <a
                      href={machine.publicUrl ?? "#"}
                      className="truncate text-xs font-medium text-primary hover:underline"
                    >
                      {machine.publicUrl ?? "No public URL"}
                    </a>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground">
            This app uses a free shared IPv4 (Anycast) and is reachable at
            <span className="font-mono">https://{application.slug}.fly.dev</span>.
            No dedicated IPv4 or paid IPv6 is allocated.
          </p>

          <EditApplicationDialog
            application={application}
            open={editOpen}
            onOpenChange={setEditOpen}
            onUpdated={() => void load()}
          />
          <DeleteApplicationDialog
            application={application}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeleted={() => {
              router.push("/apps");
              router.refresh();
            }}
          />
        </>
      ) : null}
    </div>
  );
}

const queryClient = new QueryClient();

export function ApplicationDetailProvider({ id }: { id: string }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ApplicationDetail id={id} />
    </QueryClientProvider>
  );
}