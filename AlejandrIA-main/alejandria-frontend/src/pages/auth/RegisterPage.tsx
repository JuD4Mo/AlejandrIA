import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { useAuth } from "@/auth/AuthProvider";
import { landingPath } from "@/auth/capabilities";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { es } from "@/i18n/es";
import { ApiError } from "@/api/client";
import { mapApiError, type MappedApiError } from "@/lib/errors";
import { passwordProblem } from "@/lib/password";
import { useState } from "react";
import { AuthLayout } from "./AuthLayout";
import type { SceneMode } from "./scene/tokens";

const schema = z
  .object({
    display_name: z.string().trim().min(1, es.auth.displayNameRequired),
    email: z
      .string()
      .min(1, es.auth.emailInvalid)
      .email(es.auth.emailInvalid),
    password: z
      .string()
      .superRefine((value, context) => {
        const problem = passwordProblem(value);
        if (problem === "tooShort") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: es.auth.passwordTooShort,
          });
        }
        if (problem === "tooLong") {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: es.auth.passwordTooLong,
          });
        }
      }),
    confirm: z.string(),
  })
  .refine((values) => values.password === values.confirm, {
    path: ["confirm"],
    message: es.auth.passwordMismatch,
  });

type FormValues = z.infer<typeof schema>;

export function RegisterPage() {
  useDocumentTitle(es.routeTitles.register);
  const { register: createAccount } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<MappedApiError | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {
      display_name: "",
      email: "",
      password: "",
      confirm: "",
    },
  });

  const [focused, setFocused] = useState(false);
  const sceneMode: SceneMode = isSubmitting
    ? "busy"
    : error
      ? "error"
      : focused
        ? "focus"
        : "idle";

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const user = await createAccount({
        display_name: values.display_name.trim(),
        email: values.email.trim(),
        password: values.password,
      });
      navigate(landingPath(user), { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setError({
          title: es.errors.title,
          message: es.auth.registerConflict,
          next: "Inicia sesión con ese correo o usa otro.",
          fieldErrors: [],
          status: 409,
        });
      } else {
        setError(mapApiError(caught));
      }
    }
  });

  return (
    <AuthLayout
      title={es.auth.registerTitle}
      subtitle={es.auth.registerSubtitle}
      sceneMode={sceneMode}
      footer={
        <p className="m-0">
          {es.auth.hasAccount}{" "}
          <Link
            to="/login"
            className="auth-link"
          >
            {es.auth.loginLink}
          </Link>
        </p>
      }
    >
      {error ? (
        <div
          role="alert"
          className="auth-note auth-note--error"
        >
          <p className="auth-note-title">
            {error.message}
          </p>
          <p className="auth-note-next">
            {error.next}
          </p>
        </div>
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
          label={es.auth.displayName}
          htmlFor="display_name"
          error={errors.display_name?.message}
          required
        >
          <Input
            id="display_name"
            autoComplete="nickname"
            placeholder={es.auth.displayNamePlaceholder}
            aria-invalid={Boolean(errors.display_name)}
            {...register("display_name")}
          />
        </Field>
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
          hint={es.auth.passwordHint}
          required
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
        </Field>
        <Field
          label={es.auth.confirmPassword}
          htmlFor="confirm"
          error={errors.confirm?.message}
          required
        >
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.confirm)}
            {...register("confirm")}
          />
        </Field>
        <Button
          type="submit"
          size="lg"
          loading={isSubmitting}
          className="auth-submit w-full"
        >
          {isSubmitting ? es.auth.registering : es.auth.register}
        </Button>
      </form>
    </AuthLayout>
  );
}
