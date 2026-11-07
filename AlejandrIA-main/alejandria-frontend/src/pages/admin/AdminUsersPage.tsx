import { useMemo, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import type { Role, User } from "@/api/types";
import { useAuth } from "@/auth/AuthProvider";
import { LoadMore } from "@/components/LoadMore";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Field, Input } from "@/components/ui/Field";
import { PageLoader } from "@/components/ui/Loading";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { formatDate } from "@/lib/dates";

const PAGE_SIZE = 20;
const roles: Role[] = ["lector", "bibliotecario", "administrador"];

export function AdminUsersPage() {
  useDocumentTitle(es.routeTitles.adminUsers);
  const { user: me } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<User | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Set<Role>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const query = useInfiniteQuery({
    queryKey: ["users", "admin"],
    queryFn: ({ pageParam }) =>
      endpoints.users.list({ limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.data.length === PAGE_SIZE ? allPages.length * PAGE_SIZE : undefined,
    retry: 0,
  });

  const users = useMemo(() => {
    const seen = new Set<number>();
    return (query.data?.pages ?? []).flatMap((page) =>
      page.data.filter((user) => {
        if (seen.has(user.id)) return false;
        seen.add(user.id);
        return true;
      }),
    );
  }, [query.data]);

  const needle = search.trim().toLocaleLowerCase("es");
  const visible = users.filter(
    (user) =>
      !needle ||
      user.email.toLocaleLowerCase("es").includes(needle) ||
      user.display_name.toLocaleLowerCase("es").includes(needle) ||
      String(user.id).includes(needle),
  );

  const invalidate = (target?: User) => {
    void queryClient.invalidateQueries({ queryKey: ["users"] });
    if (target?.id === me?.id) {
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    }
  };

  const rolesMutation = useMutation({
    mutationFn: (target: User) =>
      endpoints.users.setRoles(target.id, {
        roles: [...selectedRoles],
      }),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: (_data, target) => {
      setMessage(es.admin.rolesUpdated);
      setEditing(null);
      invalidate(target);
    },
    onError: (error) => setActionError(error),
  });

  const activeMutation = useMutation({
    mutationFn: (input: { user: User; active: boolean }) =>
      endpoints.users.setActive(input.user.id, { is_active: input.active }),
    onMutate: () => {
      setActionError(null);
      setMessage(null);
    },
    onSuccess: (_data, variables) => {
      setMessage(
        variables.active ? es.admin.reactivateSuccess : es.admin.deactivateSuccess,
      );
      invalidate(variables.user);
    },
    onError: (error) => setActionError(error),
  });

  const editingSelf = editing?.id === me?.id;
  const removingAdmin =
    editingSelf &&
    editing?.roles.includes("administrador") &&
    !selectedRoles.has("administrador");

  return (
    <div>
      <PageHeader title={es.admin.usersTitle} description={es.admin.usersIntro} />

      <p className="mb-4 border-l-2 border-brass bg-[rgba(168,134,59,0.1)] px-4 py-3 text-[0.82rem] text-[#5c4818]">
        {es.admin.firstAdminNote}
      </p>

      {message ? (
        <p
          role="status"
          className="mb-4 border-l-2 border-[#637a68] bg-[rgba(51,69,59,0.08)] px-4 py-3 text-[0.86rem] text-[#2c4034]"
        >
          {message}
        </p>
      ) : null}
      {actionError ? (
        <div className="mb-4">
          <ErrorState error={actionError} compact />
        </div>
      ) : null}

      <div className="mb-4 max-w-md">
        <Field label={es.admin.searchPlaceholder} htmlFor="user-search">
          <Input
            id="user-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={es.admin.searchPlaceholder}
          />
        </Field>
      </div>

      {query.isPending ? (
        <PageLoader label={es.common.loading} />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={users.length ? es.admin.noUsersSearch : es.admin.noUsers}
        />
      ) : (
        <>
          <div className="divide-y divide-[rgba(243,240,250,0.12)] border border-[rgba(243,240,250,0.14)]">
            {visible.map((user) => {
              const self = user.id === me?.id;
              return (
                <article key={user.id} className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 text-[0.7rem] font-semibold text-[rgba(243,240,250,0.48)]">
                        #{user.id} · {formatDate(user.created_at)}
                      </p>
                      <h2 className="mt-0.5 font-display text-xl font-semibold">
                        {user.display_name}
                        {self ? (
                          <span className="ml-2 font-body text-[0.7rem] font-normal text-brass-text">
                            ({es.admin.you})
                          </span>
                        ) : null}
                      </h2>
                      <p className="m-0 text-[0.82rem] text-[rgba(243,240,250,0.62)]">
                        {user.email}
                      </p>
                    </div>
                    <StatusBadge tone={user.is_active ? "good" : "bad"}>
                      {user.is_active ? es.admin.active : es.admin.inactive}
                    </StatusBadge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {user.roles.length ? (
                      user.roles.map((role) => (
                        <StatusBadge key={role} tone="neutral">
                          {es.roles[role]}
                        </StatusBadge>
                      ))
                    ) : (
                      <span className="text-[0.78rem] text-[rgba(243,240,250,0.56)]">
                        {es.account.noRoles}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setEditing(user);
                        setSelectedRoles(new Set(user.roles));
                      }}
                    >
                      {es.admin.editRoles}
                    </Button>
                    {self && user.is_active ? (
                      <span className="self-center text-[0.76rem] text-[rgba(243,240,250,0.56)]">
                        {es.admin.selfDeactivateBlocked}
                      </span>
                    ) : (
                      <ConfirmDialog
                        trigger={
                          <Button
                            size="sm"
                            variant={user.is_active ? "danger" : "primary"}
                          >
                            {user.is_active
                              ? es.admin.deactivate
                              : es.admin.reactivate}
                          </Button>
                        }
                        title={
                          user.is_active
                            ? es.admin.deactivateTitle.replace(
                                "{{name}}",
                                user.display_name,
                              )
                            : es.admin.reactivateTitle.replace(
                                "{{name}}",
                                user.display_name,
                              )
                        }
                        body={
                          user.is_active
                            ? es.admin.deactivateBody
                            : es.admin.reactivateBody
                        }
                        destructive={user.is_active}
                        onConfirm={() =>
                          activeMutation.mutateAsync({
                            user,
                            active: !user.is_active,
                          })
                        }
                        loading={
                          activeMutation.isPending &&
                          activeMutation.variables?.user.id === user.id
                        }
                      />
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {query.hasNextPage ? (
            <LoadMore
              onClick={() => void query.fetchNextPage()}
              loading={query.isFetchingNextPage}
              label={es.common.loadMore}
            />
          ) : null}
        </>
      )}

      <Modal
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={
          editing
            ? es.admin.rolesTitle.replace("{{name}}", editing.display_name)
            : es.admin.editRoles
        }
        description={es.admin.rolesIntro}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {es.common.cancel}
            </Button>
            <Button
              loading={rolesMutation.isPending}
              disabled={selectedRoles.size === 0 || !editing}
              onClick={() => {
                if (editing) rolesMutation.mutate(editing);
              }}
            >
              {es.common.save}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {roles.map((role) => {
            const checked = selectedRoles.has(role);
            return (
              <label
                key={role}
                className="flex cursor-pointer items-center gap-3 border border-[rgba(243,240,250,0.16)] px-3 py-2.5 text-[0.9rem]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    setSelectedRoles((current) => {
                      const next = new Set(current);
                      if (next.has(role)) next.delete(role);
                      else next.add(role);
                      return next;
                    })
                  }
                  className="size-4 accent-[#6b2024]"
                />
                <span>{es.roles[role]}</span>
              </label>
            );
          })}
          {selectedRoles.size === 0 ? (
            <p className="text-[0.82rem] text-oxblood">{es.admin.rolesRequired}</p>
          ) : null}
          {removingAdmin ? (
            <p className="border-l-2 border-brass bg-[rgba(168,134,59,0.1)] px-3 py-2 text-[0.82rem] text-[#5c4818]">
              {es.admin.selfRoleWarning}
            </p>
          ) : null}
          {rolesMutation.isError ? (
            <ErrorState error={rolesMutation.error} compact />
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
