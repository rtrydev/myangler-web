"use client";

import { useEffect, useState } from "react";
import { Logo, Wordmark } from "./components/Logo";
import { Chip } from "./components/Chip";
import { Button } from "./components/Button";
import { SearchInput } from "./components/SearchInput";
import { WordBlock } from "./components/WordBlock";
import { ResultRow } from "./components/ResultRow";
import { Card, Note } from "./components/Card";
import { Eyebrow, RuleGold, Ornament } from "./components/Ornament";
import { TabBar } from "./components/TabBar";
import { ThemeToggle, AccentSwitcher, type Accent } from "./components/ThemeToggle";
import {
  SearchIcon,
  ClockIcon,
  StarIcon,
  StarFillIcon,
  SpeakerIcon,
  CopyIcon,
  ShareIcon,
  OfflineIcon,
  BookIcon,
  TrashIcon,
} from "./components/Icon";

const SAMPLE_SENTENCE = [
  { mm: "ဒီနေ့", en: "today" },
  { mm: "ရာသီဥတု", en: "weather" },
  { mm: "အေး", en: "cold" },
  { mm: "တယ်", en: "(ending)" },
];

const COLOR_TOKENS = [
  { name: "bg", desc: "Page background" },
  { name: "bg-2", desc: "Sidebar / well" },
  { name: "paper", desc: "Sheet / card" },
  { name: "surface", desc: "Input / hover" },
  { name: "surface-2", desc: "Subtle fill" },
  { name: "ink", desc: "Primary text" },
  { name: "ink-2", desc: "Body text" },
  { name: "ink-3", desc: "Muted text" },
  { name: "ink-faint", desc: "Faint text" },
  { name: "gold", desc: "Saffron accent" },
  { name: "gold-soft", desc: "Soft gold" },
  { name: "ruby", desc: "Lacquer primary" },
  { name: "ruby-soft", desc: "Soft ruby" },
  { name: "jade", desc: "Success / offline" },
];

export default function Page() {
  const [accent, setAccent] = useState<Accent>("ruby");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(2);
  const [activeTab, setActiveTab] = useState("search");

  useEffect(() => {
    document.body.dataset.accent = accent;
  }, [accent]);

  return (
    <div className="min-h-screen paper-tex">
      {/* ─── Header ─── */}
      <header className="border-b border-border bg-bg-2/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-8 py-5 flex items-center justify-between">
          <Wordmark scale={1.05} />
          <div className="flex items-center gap-4">
            <AccentSwitcher value={accent} onChange={setAccent} />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 py-12 space-y-20">
        {/* ─── Title ─── */}
        <section className="text-center space-y-4">
          <div className="flex justify-center">
            <Ornament />
          </div>
          <h1 className="serif text-5xl text-ink tracking-tight">
            Myangler <span className="italic text-ink-2">design system</span>
          </h1>
          <p className="serif italic text-lg text-ink-3 max-w-2xl mx-auto">
            Parchment ivory, saffron gold, ruby lacquer — a warm reading
            surface tuned for a pocket Burmese ↔ English dictionary.
          </p>
          <div className="mm text-xl text-gold">မြန်မာ ⟷ အင်္ဂလိပ်</div>
        </section>

        {/* ─── Colors ─── */}
        <section>
          <Eyebrow withRule>Color tokens</Eyebrow>
          <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {COLOR_TOKENS.map(t => (
              <Card key={t.name} className="overflow-hidden">
                <div
                  className="h-20 border-b border-border"
                  style={{ background: `var(--${t.name})` }}
                />
                <div className="p-3">
                  <div className="mono text-xs text-ink">--{t.name}</div>
                  <div className="serif italic text-xs text-ink-3 mt-0.5">{t.desc}</div>
                </div>
              </Card>
            ))}
          </div>
        </section>

        {/* ─── Typography ─── */}
        <section>
          <Eyebrow withRule>Typography</Eyebrow>
          <div className="mt-6 grid md:grid-cols-2 gap-6">
            <Card className="p-6 space-y-3">
              <div className="eyebrow eyebrow-gold">Spectral · Serif</div>
              <div className="serif text-4xl text-ink">A pocket dictionary.</div>
              <div className="serif italic text-lg text-ink-2">
                For words you want to keep close — quietly, like an old book.
              </div>
              <div className="serif text-sm text-ink-3">
                Used for headings, definitions, and body prose where warmth matters.
              </div>
            </Card>
            <Card className="p-6 space-y-3">
              <div className="eyebrow eyebrow-gold">Noto Serif Myanmar</div>
              <div className="mm text-4xl text-ink">မြန်မာစာ</div>
              <div className="mm text-lg text-ink-2">ဒီနေ့ ရာသီဥတု အေးတယ်</div>
              <div className="mm text-sm text-ink-3">ကျွန်တော် မြန်မာစာ ဖတ်နေပါတယ်</div>
            </Card>
            <Card className="p-6 space-y-3">
              <div className="eyebrow eyebrow-gold">DM Sans · UI</div>
              <div className="ui text-2xl text-ink">Search · History · Saved</div>
              <div className="ui text-sm text-ink-2">For labels, tabs, chips — everything functional.</div>
              <div className="ui text-[10px] tracking-[0.18em] uppercase text-ink-3">Eyebrow caption</div>
            </Card>
            <Card className="p-6 space-y-3">
              <div className="eyebrow eyebrow-gold">JetBrains Mono</div>
              <div className="mono text-2xl text-ink">--gold: #B07820</div>
              <div className="mono text-sm text-ink-2">/jè/ · noun · 38,412 entries</div>
              <div className="mono text-xs text-ink-3">For token names, pronunciation, code.</div>
            </Card>
          </div>
        </section>

        {/* ─── Buttons ─── */}
        <section>
          <Eyebrow withRule>Buttons</Eyebrow>
          <Card className="mt-6 p-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary">
                <StarFillIcon size={14} /> Save
              </Button>
              <Button variant="secondary">Cancel</Button>
              <Button variant="ghost">
                <TrashIcon size={14} /> Clear
              </Button>
              <Button variant="icon" aria-label="Pronounce">
                <SpeakerIcon size={16} />
              </Button>
              <Button variant="icon" aria-label="Copy">
                <CopyIcon size={16} />
              </Button>
              <Button variant="icon" aria-label="Share">
                <ShareIcon size={16} />
              </Button>
              <Button variant="primary" disabled>
                Disabled
              </Button>
            </div>
          </Card>
        </section>

        {/* ─── Chips & tags ─── */}
        <section>
          <Eyebrow withRule>Chips &amp; tags</Eyebrow>
          <Card className="mt-6 p-6">
            <div className="flex flex-wrap gap-2 items-center">
              <Chip>all</Chip>
              <Chip variant="solid">selected</Chip>
              <Chip variant="exact">exact</Chip>
              <Chip variant="partial">partial</Chip>
              <Chip variant="fuzzy">close</Chip>
              <Chip className="mm" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13 }}>
                မင်္ဂလာပါ
              </Chip>
              <Chip className="serif" style={{ textTransform: "none", letterSpacing: 0, fontSize: 13 }}>
                thank you
              </Chip>
            </div>
          </Card>
        </section>

        {/* ─── Search input ─── */}
        <section>
          <Eyebrow withRule>Search input</Eyebrow>
          <Card className="mt-6 p-6 space-y-4 max-w-2xl">
            <SearchInput
              placeholder="ရှာဖွေရန် · search a word or sentence"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onClear={() => setQuery("")}
            />
            <div className="serif italic text-xs text-ink-3">
              Focus the field to see the saffron ring. Type to reveal the clear button.
            </div>
          </Card>
        </section>

        {/* ─── Word blocks ─── */}
        <section>
          <Eyebrow withRule>Word blocks · sentence breakdown</Eyebrow>
          <Card className="mt-6 p-6 space-y-4">
            <div className="mm text-xl text-ink-2 leading-relaxed pb-4 border-b border-dashed border-border-2">
              ဒီနေ့ ရာသီဥတု အေးတယ်
              <div className="serif italic text-sm text-ink-3 mt-1">
                &ldquo;Today, the weather is cold.&rdquo; · tap a block to select
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {SAMPLE_SENTENCE.map((w, i) => (
                <WordBlock
                  key={i}
                  mm={w.mm}
                  en={w.en}
                  selected={i === selected}
                  onClick={() => setSelected(i)}
                />
              ))}
              <WordBlock mm="??" en="unknown" unknown />
            </div>
            <Note label="Note">
              We give our best split. If a word looks off, look it up alone in the box above.
            </Note>
          </Card>
        </section>

        {/* ─── Result rows ─── */}
        <section>
          <Eyebrow withRule>Result rows</Eyebrow>
          <Card className="mt-6 overflow-hidden">
            <div className="px-4 pt-4 flex justify-between items-center">
              <Eyebrow>10 results · English → မြန်မာ</Eyebrow>
              <span className="ui text-[11px] text-ink-faint">240 ms</span>
            </div>
            <div className="mt-3">
              <ResultRow
                group={["ရေ"]}
                en="water"
                meaning="water; liquid; (poetic) river, sea"
                tag="exact"
              />
              <ResultRow
                group={["ရေသန့်", "သောက်ရေ"]}
                en="drinking water"
                meaning="purified or potable water"
                tag="exact"
              />
              <ResultRow
                mm="ရေချိုး"
                en="to bathe"
                meaning="lit. wash with water"
                tag="partial"
              />
              <ResultRow
                mm="မိုးရေ"
                en="rainwater"
                meaning="water from rain"
                tag="partial"
              />
              <ResultRow
                mm="ဝတ်"
                en="to wear"
                note="did you mean &lsquo;wear&rsquo;?"
                tag="fuzzy"
              />
            </div>
          </Card>
        </section>

        {/* ─── Iconography ─── */}
        <section>
          <Eyebrow withRule>Iconography</Eyebrow>
          <Card className="mt-6 p-6">
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-4 text-ink-2">
              {[
                { Icon: SearchIcon, name: "search" },
                { Icon: ClockIcon, name: "clock" },
                { Icon: StarIcon, name: "star" },
                { Icon: StarFillIcon, name: "starFill" },
                { Icon: BookIcon, name: "book" },
                { Icon: SpeakerIcon, name: "speaker" },
                { Icon: CopyIcon, name: "copy" },
                { Icon: ShareIcon, name: "share" },
                { Icon: TrashIcon, name: "trash" },
                { Icon: OfflineIcon, name: "offline" },
              ].map(({ Icon, name }) => (
                <div key={name} className="flex flex-col items-center gap-2">
                  <div className="w-12 h-12 rounded-md border border-border bg-surface flex items-center justify-center">
                    <Icon size={20} />
                  </div>
                  <div className="mono text-[10px] text-ink-3">{name}</div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        {/* ─── Tab bar ─── */}
        <section>
          <Eyebrow withRule>Tab bar · mobile</Eyebrow>
          <Card className="mt-6 overflow-hidden max-w-md">
            <div className="h-32 bg-paper paper-tex flex items-center justify-center serif italic text-ink-3">
              app content
            </div>
            <TabBar
              active={activeTab}
              onChange={setActiveTab}
              items={[
                { id: "search", label: "Look up", icon: ({ size }) => <SearchIcon size={size} /> },
                { id: "history", label: "History", icon: ({ size }) => <ClockIcon size={size} /> },
                { id: "fav", label: "Saved", icon: ({ size }) => <StarIcon size={size} /> },
              ]}
            />
          </Card>
        </section>

        {/* ─── Status / ornaments ─── */}
        <section>
          <Eyebrow withRule>Ornaments &amp; status</Eyebrow>
          <div className="mt-6 grid md:grid-cols-3 gap-4">
            <Card className="p-6 flex flex-col items-center gap-3">
              <Ornament />
              <div className="serif text-sm text-ink-3 italic">Filigree ornament</div>
            </Card>
            <Card className="p-6 flex flex-col items-center justify-center gap-3 min-h-[120px]">
              <RuleGold />
              <div className="serif text-sm text-ink-3 italic">Gold rule</div>
              <RuleGold />
            </Card>
            <Card className="p-6 flex flex-col items-center justify-center gap-2 min-h-[120px]">
              <div className="flex items-center gap-2 text-jade">
                <OfflineIcon size={14} />
                <span className="ui text-[11px] tracking-wider text-jade">Ready offline · 38,412 entries</span>
              </div>
              <div className="serif text-sm text-ink-3 italic">Offline / status pill</div>
            </Card>
          </div>
        </section>

        {/* ─── Footer ─── */}
        <footer className="pt-10 border-t border-border text-center space-y-3">
          <div className="flex justify-center"><Logo size={36} /></div>
          <div className="serif italic text-sm text-ink-3">
            Each component above is available under <span className="mono text-ink-2">app/components/</span>.
            Build screens by composing them.
          </div>
        </footer>
      </main>
    </div>
  );
}
