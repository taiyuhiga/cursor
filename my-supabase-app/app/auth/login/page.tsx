import { LoginForm } from "@/components/login-form";

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function Page({ searchParams }: Props) {
  const params = await searchParams;
  const nextPath = typeof params.next === "string" ? params.next : undefined;

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <LoginForm nextPath={nextPath} />
      </div>
    </div>
  );
}
