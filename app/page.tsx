export default function SetupPage() {
  const webhookPath = '/api/alexa';

  const steps = [
    {
      number: '01',
      title: 'Deploy to Vercel',
      body: (
        <>
          Push this repo to GitHub, then import it at{' '}
          <A href="https://vercel.com/new">vercel.com/new</A>. During setup, add these environment
          variables:
          <EnvBlock>
            {`EIGHT_SLEEP_EMAIL=you@example.com
EIGHT_SLEEP_PASSWORD=yourpassword`}
          </EnvBlock>
          Optionally, after creating your Alexa skill (step 03), come back and add:
          <EnvBlock>ALEXA_SKILL_ID=amzn1.ask.skill.xxxx</EnvBlock>
        </>
      ),
    },
    {
      number: '02',
      title: 'Note your webhook URL',
      body: (
        <>
          Once deployed, your Alexa webhook is at:
          <EnvBlock>{`https://YOUR-VERCEL-DOMAIN.vercel.app${webhookPath}`}</EnvBlock>
          You'll paste this into the Alexa Developer Console in the next step.
        </>
      ),
    },
    {
      number: '03',
      title: 'Create an Alexa Custom Skill',
      body: (
        <ol className="list-decimal list-inside space-y-2 text-zinc-300">
          <li>
            Go to{' '}
            <A href="https://developer.amazon.com/alexa/console/ask">
              developer.amazon.com/alexa/console/ask
            </A>{' '}
            and sign in with your Amazon account.
          </li>
          <li>
            Click <Kbd>Create Skill</Kbd>. Name it <strong>Eight Sleep</strong>.
          </li>
          <li>
            Choose <Kbd>Other</Kbd> → <Kbd>Custom</Kbd> → <Kbd>Provision your own</Kbd>. Click{' '}
            <Kbd>Create Skill</Kbd>.
          </li>
          <li>
            When asked for a template, choose <Kbd>Start from Scratch</Kbd>.
          </li>
        </ol>
      ),
    },
    {
      number: '04',
      title: 'Import the interaction model',
      body: (
        <ol className="list-decimal list-inside space-y-2 text-zinc-300">
          <li>
            In the left sidebar, click <Kbd>Interaction Model</Kbd> → <Kbd>JSON Editor</Kbd>.
          </li>
          <li>
            Drag and drop (or paste the contents of){' '}
            <code className="text-blue-400">skill/en-US.json</code> from this repo into the editor.
          </li>
          <li>
            Click <Kbd>Save Model</Kbd> then <Kbd>Build Model</Kbd>. Wait for it to finish.
          </li>
        </ol>
      ),
    },
    {
      number: '05',
      title: 'Point the skill at your Vercel deployment',
      body: (
        <ol className="list-decimal list-inside space-y-2 text-zinc-300">
          <li>
            In the left sidebar, click <Kbd>Endpoint</Kbd>.
          </li>
          <li>
            Select <Kbd>HTTPS</Kbd> and paste your webhook URL:{' '}
            <code className="text-blue-400">{`https://YOUR-DOMAIN.vercel.app${webhookPath}`}</code>
          </li>
          <li>
            For SSL cert type, choose <Kbd>My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority</Kbd>.
          </li>
          <li>
            Copy the <strong>Skill ID</strong> shown at the top of that page (starts with{' '}
            <code className="text-blue-400">amzn1.ask.skill.</code>) and add it as{' '}
            <code className="text-blue-400">ALEXA_SKILL_ID</code> in your Vercel env vars.
          </li>
          <li>
            Click <Kbd>Save Endpoints</Kbd>.
          </li>
        </ol>
      ),
    },
    {
      number: '06',
      title: 'Enable the skill on your Alexa device',
      body: (
        <ol className="list-decimal list-inside space-y-2 text-zinc-300">
          <li>Open the Alexa app on your phone.</li>
          <li>
            Go to <Kbd>More</Kbd> → <Kbd>Skills &amp; Games</Kbd> → <Kbd>Your Skills</Kbd> →{' '}
            <Kbd>Dev</Kbd>.
          </li>
          <li>Find <strong>Eight Sleep</strong> and tap <Kbd>Enable to Use</Kbd>.</li>
        </ol>
      ),
    },
  ];

  return (
    <main className="mx-auto max-w-3xl px-6 py-16 space-y-12">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-4xl">🛏️</span>
          <h1 className="text-3xl font-bold tracking-tight">Eight Sleep × Alexa</h1>
        </div>
        <p className="text-zinc-400 text-lg">
          Voice control for your Eight Sleep alarms — set, snooze, dismiss, and cancel, all with
          Alexa.
        </p>
      </div>

      {/* Voice commands quick reference */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-4">
        <h2 className="font-semibold text-lg text-zinc-100">Voice Commands</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['Set alarm', '"Alexa, tell Eight Sleep to set an alarm for 7 AM"'],
            ['Snooze', '"Alexa, tell Eight Sleep to snooze"'],
            ['Snooze with time', '"Alexa, tell Eight Sleep to snooze for 10 minutes"'],
            ['Dismiss alarm', '"Alexa, tell Eight Sleep to dismiss alarm"'],
            ['Cancel alarm', '"Alexa, tell Eight Sleep to cancel my alarm"'],
            ['List alarms', '"Alexa, ask Eight Sleep what alarms I have"'],
          ].map(([label, phrase]) => (
            <div key={label} className="rounded-xl bg-zinc-800 px-4 py-3">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide mb-1">
                {label}
              </p>
              <p className="text-sm text-zinc-200 italic">{phrase}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Setup steps */}
      <section className="space-y-6">
        <h2 className="font-semibold text-lg text-zinc-100">Setup Guide</h2>
        {steps.map((step) => (
          <div
            key={step.number}
            className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-3"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-xs font-bold text-blue-400 bg-blue-400/10 px-2 py-1 rounded-lg">
                {step.number}
              </span>
              <h3 className="font-semibold text-zinc-100">{step.title}</h3>
            </div>
            <div className="text-sm text-zinc-400 leading-relaxed space-y-2">{step.body}</div>
          </div>
        ))}
      </section>

      {/* Webhook status indicator */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 space-y-2">
        <h2 className="font-semibold text-lg text-zinc-100">Webhook Endpoint</h2>
        <p className="text-sm text-zinc-400">
          The Alexa skill webhook lives at:
        </p>
        <code className="block bg-zinc-800 rounded-lg px-4 py-3 text-sm text-blue-300 break-all">
          {webhookPath}
        </code>
        <p className="text-xs text-zinc-500">
          Point your Alexa skill&apos;s HTTPS endpoint here (prefixed with your Vercel domain).
        </p>
      </section>
    </main>
  );
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
    >
      {children}
    </a>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block bg-zinc-800 text-zinc-200 text-xs font-mono px-1.5 py-0.5 rounded border border-zinc-700">
      {children}
    </kbd>
  );
}

function EnvBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-2 bg-zinc-800 rounded-lg px-4 py-3 text-xs text-green-300 overflow-x-auto">
      {children}
    </pre>
  );
}
