import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "@/api/endpoints";
import { useAuth } from "@/auth/AuthProvider";
import { canRead, canStaff } from "@/auth/capabilities";
import { es } from "@/i18n/es";
import {
  isOnboardingComplete,
  markOnboardingComplete,
} from "@/lib/onboarding";
import { Constellation } from "./Constellation";
import { OnboardingExperience } from "./OnboardingExperience";

const questions = es.onboarding.questions;
const nodeLabels = questions.map((question) => question.nodeLabel);

function OnboardingLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto h-72 w-full">
          <Constellation connected={0} labels={nodeLabels} phase="idle" />
        </div>
        <p role="status" className="mt-2 text-[0.88rem] text-[rgba(243,240,250,0.62)]">
          {es.onboarding.loading}
        </p>
      </div>
    </div>
  );
}

export function OnboardingGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [done, setDone] = useState(false);

  const eligible = Boolean(user && canRead(user) && !canStaff(user));
  const firstVisit = Boolean(
    user && eligible && !done && !isOnboardingComplete(user.id),
  );

  const preferencesQuery = useQuery({
    queryKey: ["preferences", "genres"],
    queryFn: () => endpoints.personalization.preferences({ limit: 100 }),
    enabled: firstVisit,
    retry: 0,
  });

  const hasPreferences = Boolean(preferencesQuery.data?.data.length);
  const needsOnboarding =
    firstVisit && preferencesQuery.isSuccess && !hasPreferences;

  const genresQuery = useQuery({
    queryKey: ["named", "genres", "onboarding"],
    queryFn: () => endpoints.named.list("genres", { limit: 100 }),
    enabled: needsOnboarding,
    retry: 0,
  });

  const saveMutation = useMutation({
    mutationFn: (genreIds: number[]) =>
      endpoints.personalization.replacePreferences(genreIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["preferences"] });
      void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
    },
  });

  if (!firstVisit || done) return <>{children}</>;
  if (preferencesQuery.isPending) return <OnboardingLoading />;
  if (preferencesQuery.isError || hasPreferences) return <>{children}</>;
  if (genresQuery.isPending) return <OnboardingLoading />;

  const finish = () => {
    if (user) markOnboardingComplete(user.id);
    setDone(true);
  };

  return (
    <OnboardingExperience
      genres={genresQuery.data?.data ?? []}
      onSave={(genreIds) => saveMutation.mutateAsync(genreIds).then(() => undefined)}
      onDone={finish}
      onSkip={finish}
    />
  );
}
