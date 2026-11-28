import { useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useApi } from "../app/context";
import { LoadState } from "../app/Status";
import { useLoad } from "../app/useLoad";
import { useTitle } from "../app/useTitle";
import { Icon } from "../design/Icon";
import { Logo } from "../design/ui";
import { firstStep } from "./rules";
import { ProvidersStep } from "./ProvidersStep";
import { SetupCheck } from "./SetupCheck";
import { TryStep } from "./TryStep";
import { VoiceStep } from "./VoiceStep";
import "./firstrun.css";

const STEPS = [
  { id: "providers", label: "Providers" },
  { id: "voice", label: "Voice" },
  { id: "try", label: "Try it" },
] as const;
type StepId = (typeof STEPS)[number]["id"];

function Stepper({ at }: { at: number }) {
  return (
    <ol className="fr-steps" aria-label="Setup steps">
      {STEPS.map((s, i) => {
        const state = i < at ? "done" : i === at ? "now" : "next";
        return (
          <li key={s.id} className={`fr-step ${state}`} aria-current={state === "now" ? "step" : undefined}>
            <span className="fr-n">{state === "done" ? <Icon name="check" /> : i + 1}</span>
            <span className="fr-lbl">{s.label}</span>
            {state === "done" && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * First-time setup at `/welcome/:step`: providers, voice, try it. What the
 * engine says is set decides the first step; the address says the rest, so
 * a refresh stays where it is. Nothing is kept here that the engine does not
 * keep (`GET /v1/setup`).
 */
export function FirstRun() {
  useTitle("Set up");
  const client = useApi();
  const navigate = useNavigate();
  const { step } = useParams<{ step?: string }>();
  const setup = useLoad(() => client.setup(), [client]);
  const [connected, setConnected] = useState<number>();

  if (!setup.data) return (
    <div className="fr">
      <header className="fr-top"><Link to="/" className="fr-logo-link" aria-label="Open Sourcebook home"><Logo /></Link></header>
      <main className="fr-main"><LoadState loading={setup.loading} error={setup.error} what="setup" onRetry={() => void setup.reload()} /></main>
    </div>
  );

  const count = connected ?? setup.data.providers.connected;
  const known = STEPS.find((s) => s.id === step);
  if (!known) return <Navigate replace to={`/welcome/${firstStep(setup.data)}`} />;
  // A later step needs an agent; a person who has none is taken back to the first.
  if (known.id !== "providers" && count === 0) return <Navigate replace to="/welcome/providers" />;
  const at = STEPS.findIndex((s) => s.id === known.id);
  const go = (id: StepId) => navigate(`/welcome/${id}`);

  return (
    <div className="fr">
      <header className="fr-top">
        <Link to="/" className="fr-logo-link" aria-label="Open Sourcebook home">
          <Logo />
        </Link>
        <span className="fr-of">Step {at + 1} of 3</span>
      </header>
      <main className="fr-main">
        <div className="fr-col">
          <Stepper at={at} />
          {known.id === "providers" && <SetupCheck />}
          {known.id === "providers" && <ProvidersStep onConnected={setConnected} onNext={() => go("voice")} />}
          {known.id === "voice" && <VoiceStep onBack={() => go("providers")} onNext={() => go("try")} />}
          {known.id === "try" && <TryStep onBack={() => go("voice")} />}
        </div>
      </main>
    </div>
  );
}
