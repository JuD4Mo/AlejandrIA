import { zodResolver } from "@hookform/resolvers/zod";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/auth/AuthProvider";
import { landingPath } from "@/auth/capabilities";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { mapApiError, type MappedApiError } from "@/lib/errors";
import { AuthLayout } from "./AuthLayout";
import type { SceneMode } from "./scene/tokens";

const schema = z.object({
  email: z.string().min(1, es.auth.emailInvalid).email(es.auth.emailInvalid),
  password: z.string().min(1, es.auth.passwordTooShort),
});

type FormValues = z.infer<typeof schema>;

function safeNext(value: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.startsWith("/login") || value.startsWith("/register")) return null;
  return value;
}

export function LoginPage() {
  useDocumentTitle(es.routeTitles.login);
  const { login, flash, clearFlash } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const reduced = useReducedMotion() ?? false;
  const [error, setError] = useState<MappedApiError | null>(null);
  const [focused, setFocused] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const user = await login(values);
      clearFlash();
      navigate(safeNext(searchParams.get("next")) ?? landingPath(user), {
        replace: true,
      });
    } catch (caught) {
      setError(mapApiError(caught));
    }
  });

  // The scene mirrors what the form is doing: idle -> focus -> busy -> error.
  const sceneMode: SceneMode = isSubmitting
    ? "busy"
    : error
      ? "error"
      : focused
        ? "focus"
        : "idle";

  return (
    <AuthLayout
      title={es.auth.loginTitle}
      subtitle={es.auth.loginSubtitle}
      sceneMode={sceneMode}
      footer={
        <p className="m-0">
          {es.auth.noAccount}{" "}
          <Link to="/register" className="auth-link">
            {es.auth.registerLink}
          </Link>
        </p>
      }
    >
      {flash ? (
        <div role="status" className="auth-note">
          <p>{flash}</p>
        </div>
      ) : null}
      {error ? (
        <motion.div
          role="alert"
          className="auth-note auth-note--error"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.12 : 0.24, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <p className="auth-note-title">{error.message}</p>
          <p className="auth-note-next">{error.next}</p>
        </motion.div>
      ) : null}
      <form
        onSubmit={onSubmit}
        noValidate
        className="space-y-5"
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        <Field
          label={es.auth.email}
          htmlFor="email"
          error={errors.email?.message}
          required
        >
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder={es.auth.emailPlaceholder}
            aria-invalid={Boolean(errors.email)}
            {...register("email")}
          />
        </Field>
        <Field
          label={es.auth.password}
          htmlFor="password"
          error={errors.password?.message}
          required
        >
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder={es.auth.passwordPlaceholder}
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
        </Field>
        <Button
          type="submit"
          size="lg"
          loading={isSubmitting}
          className="auth-submit w-full"
        >
          {isSubmitting ? es.auth.loggingIn : es.auth.login}
        </Button>
      </form>
    </AuthLayout>
  );
}
