import crypto from "node:crypto";
import Link from "next/link";
import { Suspense, cache } from "react";
import { ArrowUpRight, ClipboardList, TriangleAlert } from "lucide-react";
import AvatarContact from "@/components/AvatarContact";
import GridStats from "@/components/GridStats";
import NavPages from "@/components/NavPages";
import SectionPage, { SectionCount } from "@/components/SectionPage";
import ShellSparkLoop, { NoticeError } from "@/components/ShellSparkLoop";
import StateEmpty from "@/components/StateEmpty";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCount, formatNumber, formatRelative } from "@/lib/format";
import { createSparkLoop } from "@/lib/sparkloop";
import { loadSparkLoopPage } from "@/lib/sparkloop-account";
import { SPARKLOOP_URLS } from "@/lib/sparkloop-content";

export const metadata = { title: "Welcome survey" };

const CHART_TYPES = new Set(["single_select", "multi_select", "checkbox"]);
const TYPE_LABELS = {
	text_input: "Free text",
	single_select: "One choice",
	multi_select: "Several choices",
	checkbox: "Checkbox",
};

// The first page of answers feeds both the latest written answers and the list: one request per render.
const getSubmissions = cache((apiKey, publicationUuid, surveyUuid, page) =>
	createSparkLoop(apiKey).publication(publicationUuid).listSurveySubmissions(surveyUuid, { page })
);

export default async function SurveyPage({ searchParams }) {
	const params = await searchParams;
	const page = await loadSparkLoopPage(params.newsletter);
	const pageNumber = Math.max(1, Number.parseInt(params.page, 10) || 1);

	return (
		<ShellSparkLoop
			feature="survey"
			page={page}
			basePath="/sparkloop/survey"
			dashboardHref={SPARKLOOP_URLS.survey}
			dashboardLabel="Edit questions"
		>
			<Suspense key={page.publicationUuid} fallback={<SkeletonSurvey />}>
				<SectionsSurvey apiKey={page.apiKey} newsletter={page.selected} pageNumber={pageNumber} />
			</Suspense>
		</ShellSparkLoop>
	);
}

async function SectionsSurvey({ apiKey, newsletter, pageNumber }) {
	const { publicationUuid } = newsletter.sparkloop;
	const client = createSparkLoop(apiKey).publication(publicationUuid);
	let surveys;
	try {
		({ surveys = [] } = await client.listSurveys());
	} catch (error) {
		return <NoticeError error={error} href={SPARKLOOP_URLS.survey} />;
	}

	const [survey] = surveys;
	if (!survey) {
		return (
			<StateEmpty icon={ClipboardList} title="No welcome survey yet">
				<p className="max-w-sm text-sm text-pretty text-muted-foreground">
					Write the questions in SparkLoop&apos;s signup flow editor. Answers show up here.
				</p>
				<Button asChild variant="outline" size="sm">
					<a href={SPARKLOOP_URLS.survey} target="_blank" rel="noopener">
						Create it in SparkLoop
						<ArrowUpRight data-icon="inline-end" className="opacity-60" />
					</a>
				</Button>
			</StateEmpty>
		);
	}

	const id = newsletter._id.toString();
	const query = { apiKey, publicationUuid, surveyUuid: survey.uuid };

	return (
		<div className="flex flex-col gap-8 animate-fade-in">
			{!survey.active_in_signup_flow && (
				<p className="flex items-start gap-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-pretty text-amber-950 ring-1 ring-amber-500/30 dark:bg-amber-500/10 dark:text-amber-50">
					<TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
					<span>
						New readers don&apos;t see the survey: it&apos;s off in the signup flow.{" "}
						<Link href={`/sparkloop/signup-flow?newsletter=${id}`} className="font-medium underline underline-offset-2">
							Turn it on
						</Link>
					</span>
				</p>
			)}
			<Suspense fallback={<SkeletonQuestions />}>
				<SectionsQuestions client={client} query={query} />
			</Suspense>
			<Suspense key={pageNumber} fallback={<Skeleton className="h-64 rounded-xl" />}>
				<SectionAnswers query={query} pageNumber={pageNumber} newsletterId={id} />
			</Suspense>
		</div>
	);
}

async function SectionsQuestions({ client, query }) {
	let details;
	let questions;
	try {
		[details, { questions = [] }] = await Promise.all([
			client.getSurvey(query.surveyUuid),
			client.listSurveyQuestions(query.surveyUuid),
		]);
	} catch (error) {
		return <NoticeError error={error} href={SPARKLOOP_URLS.survey} />;
	}
	// One request per question SparkLoop can count; a failed one says so, instead of "no answers".
	const [charts, latest] = await Promise.all([
		Promise.all(
			questions.map(async (question) => {
				if (!CHART_TYPES.has(question.type)) return question;
				try {
					const found = await client.getSurveyQuestionStats(query.surveyUuid, question.uuid);
					return { ...question, stats: found?.question?.stats ?? found?.stats ?? null };
				} catch (error) {
					return { ...question, error: error.message };
				}
			})
		),
		getSubmissions(query.apiKey, query.publicationUuid, query.surveyUuid, 1).catch(() => ({ submissions: [] })),
	]);
	const stats = details?.survey?.stats ?? {};

	return (
		<>
			<SectionPage title="Last 30 days">
				<GridStats
					items={[
						{ label: "Shown", value: formatNumber(stats.impressions) },
						{ label: "Answered", value: formatNumber(stats.completions) },
						{
							label: "Answer rate",
							value: stats.impressions ? `${Math.round((stats.completions / stats.impressions) * 100)}%` : null,
							detail: "of readers who saw it",
						},
					]}
				/>
			</SectionPage>

			{charts.length > 0 && (
				<SectionPage title="Questions" stagger={1}>
					<div className="grid gap-3 md:grid-cols-2">
						{charts.map((question) => (
							<CardQuestion
								key={question.uuid}
								question={question}
								latest={latestAnswers(latest.submissions ?? [], question.uuid)}
							/>
						))}
					</div>
				</SectionPage>
			)}
		</>
	);
}

async function SectionAnswers({ query, pageNumber, newsletterId }) {
	let result;
	try {
		result = await getSubmissions(query.apiKey, query.publicationUuid, query.surveyUuid, pageNumber);
	} catch (error) {
		return (
			<SectionPage title="Answers" stagger={2}>
				<NoticeError error={error} />
			</SectionPage>
		);
	}
	const submissions = result.submissions ?? [];
	const meta = result.meta ?? {};
	const href = (number) => `/sparkloop/survey?newsletter=${newsletterId}&page=${number}`;

	return (
		<SectionPage title="Answers" meta={<SectionCount value={meta.total_submissions} label="in all" />} stagger={2}>
			{submissions.length === 0 ? (
				<p className="rounded-xl px-4 py-6 text-center text-sm text-muted-foreground shadow-border">No answers yet</p>
			) : (
				<ul className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card shadow-border">
					{submissions.map((submission) => (
						<li key={submission.uuid} className="flex flex-col gap-3 p-4">
							<div className="flex items-center gap-3">
								<AvatarContact email={submission.email} gravatarHash={gravatarHash(submission.email)} size={28} />
								<p className="min-w-0 flex-1 truncate text-sm font-medium">{submission.email}</p>
								<p className="shrink-0 text-xs text-muted-foreground">{formatRelative(submission.submitted_at)}</p>
							</div>
							<dl className="grid gap-x-6 gap-y-2 pl-10 sm:grid-cols-2">
								{(submission.answers ?? []).map((answer) => (
									<div key={answer.question?.uuid ?? answer.answered_at} className="min-w-0">
										<dt className="truncate text-xs text-muted-foreground">{answer.question?.label}</dt>
										<dd className="text-sm text-pretty break-words">
											{Array.isArray(answer.value) ? answer.value.join(", ") : String(answer.value ?? "")}
										</dd>
									</div>
								))}
							</dl>
						</li>
					))}
				</ul>
			)}
			<NavPages page={meta.page ?? pageNumber} totalPages={meta.total_pages} href={href} />
		</SectionPage>
	);
}

// Written answers can't be counted, so their card shows the newest few.
function latestAnswers(submissions, questionUuid) {
	return submissions
		.map(({ uuid, answers }) => ({ uuid, answer: answers?.find(({ question }) => question?.uuid === questionUuid) }))
		.filter(({ answer }) => answer && String(answer.value ?? "").trim())
		.slice(0, 4)
		.map(({ uuid, answer }) => ({ uuid, value: String(answer.value) }));
}

function CardQuestion({ question, latest }) {
	const distribution = question.stats?.distribution ?? [];
	const total = question.stats?.total_answers ?? distribution.reduce((sum, { count }) => sum + count, 0);
	const isChart = CHART_TYPES.has(question.type);
	const isEmpty = isChart ? distribution.length === 0 : latest.length === 0;

	return (
		<div className="flex flex-col gap-4 rounded-xl bg-card p-4 shadow-border">
			<div>
				<p className="text-xs text-muted-foreground">
					{question.position}. {TYPE_LABELS[question.type] ?? question.type}
					{question.required ? " · required" : ""}
				</p>
				<p className="mt-1 text-sm font-medium text-pretty">{question.label}</p>
			</div>
			{question.error && <p className="text-sm text-muted-foreground">{question.error}</p>}
			{isChart && distribution.length > 0 && (
				<ul className="flex flex-col gap-2.5">
					{distribution.map(({ value, count }) => {
						const share = total ? count / total : 0;
						return (
							<li key={String(value)}>
								<div className="flex items-baseline justify-between gap-3 text-sm">
									<span className="min-w-0 truncate">{String(value)}</span>
									<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
										{formatNumber(count)} · {Math.round(share * 100)}%
									</span>
								</div>
								<div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
									<div
										className="h-full rounded-full bg-foreground/70"
										style={{ width: `${Math.max(share * 100, count > 0 ? 2 : 0)}%` }}
									/>
								</div>
							</li>
						);
					})}
				</ul>
			)}
			{!isChart && latest.length > 0 && (
				<ul className="flex flex-col gap-1.5">
					{latest.map(({ uuid, value }) => (
						<li key={uuid} className="truncate rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm">
							{value}
						</li>
					))}
				</ul>
			)}
			{!question.error && isEmpty && <p className="text-sm text-muted-foreground">No answers yet.</p>}
			{!isEmpty && (
				<p className="mt-auto text-xs text-muted-foreground">
					{isChart ? formatCount(total, "answer") : "Latest answers. Every one is below."}
				</p>
			)}
		</div>
	);
}

function gravatarHash(email) {
	return crypto.createHash("sha256").update(String(email).trim().toLowerCase()).digest("hex");
}

function SkeletonQuestions() {
	return (
		<div className="flex flex-col gap-8">
			<Skeleton className="h-[89px] rounded-xl" />
			<div className="grid gap-3 md:grid-cols-2">
				<Skeleton className="h-48 rounded-xl" />
				<Skeleton className="h-48 rounded-xl" />
			</div>
		</div>
	);
}

function SkeletonSurvey() {
	return (
		<div className="flex flex-col gap-8">
			<SkeletonQuestions />
			<Skeleton className="h-64 rounded-xl" />
		</div>
	);
}
