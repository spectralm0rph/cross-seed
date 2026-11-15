import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const TEST_ROOT = await mkdtemp(join(tmpdir(), "cross-seed-decide-tests-"));

/**
 * decide.ts opens the SQLite database (and the config directory behind it) the
 * moment it is imported, so CONFIG_DIR has to exist first. A static import
 * would run before this setup, hence the dynamic imports.
 */
async function setup() {
	process.env.CONFIG_DIR = await mkdtemp(join(TEST_ROOT, "config-"));
	vi.resetModules();

	const configuration = await import("../src/configuration.js");
	const { initializeLogger, Label } = await import("../src/logger.js");
	const { setRuntimeConfig } = await import("../src/runtimeConfig.js");
	const { Decision } = await import("../src/constants.js");
	const { assessCandidate } = await import("../src/decide.js");

	configuration.createAppDirHierarchy();
	initializeLogger({ verbose: false });
	setRuntimeConfig(configuration.getDefaultRuntimeConfig());

	return { assessCandidate, Decision, Label };
}

const env = await setup();

/**
 * Run the real candidate assessment. A candidate without a download link stops
 * after the name based checks, so a passed release group check reports
 * NO_DOWNLOAD_LINK instead of reaching out to a tracker.
 */
async function decide(searcheeTitle: string, candidateName: string) {
	const { decision } = await env.assessCandidate(
		{
			name: candidateName,
			guid: `guid-${candidateName}`,
			link: "",
			tracker: "test-tracker",
		},
		{
			title: searcheeTitle,
			name: searcheeTitle,
			files: [],
			length: 0,
			label: env.Label.SEARCH,
		},
		new Set<string>(),
		[],
	);
	return decision;
}

describe("release group matching", () => {
	it.each([
		// The group sits in front of the title on one side and behind it on the
		// other, so the trailing parse alone only sees the title.
		[
			"voices38-star.wars.galactic.racer",
			"STAR.WARS.Galactic.Racer-voices38",
		],
		[
			"STAR.WARS.Galactic.Racer-voices38",
			"voices38-STAR.WARS.Galactic.Racer",
		],
		[
			"voices38-star.wars.galactic.racer",
			"STAR.WARS.Galactic.Racer-VOICES38",
		],
	])("matches %j with %j", async (searcheeTitle, candidateName) => {
		const decision = await decide(searcheeTitle, candidateName);
		expect(decision).toBe(env.Decision.NO_DOWNLOAD_LINK);
	});

	it.each([
		[
			"voices38-star.wars.galactic.racer",
			"STAR.WARS.Galactic.Racer-COASTER",
		],
		[
			"STAR.WARS.Galactic.Racer-COASTER",
			"voices38-star.wars.galactic.racer",
		],
		// The leading group is compared exactly, never as a prefix of a group
		[
			"voices38-star.wars.galactic.racer",
			"STAR.WARS.Galactic.Racer-voices38x",
		],
		[
			"STAR.WARS.Galactic.Racer-voices38x",
			"voices38-star.wars.galactic.racer",
		],
		["ABC-Movie.2020.1080p-XYZ", "Movie.2020.1080p-ABC"],
		["Movie.2020.1080p-ABC", "ABC-Movie.2020.1080p-XYZ"],
	])("does not match %j with %j", async (searcheeTitle, candidateName) => {
		const decision = await decide(searcheeTitle, candidateName);
		expect(decision).toBe(env.Decision.RELEASE_GROUP_MISMATCH);
	});

	it("still matches trailing release groups", async () => {
		const decision = await decide(
			"My.Movie.2019.1080p.BluRay.x264-SPARKS",
			"My.Movie.2019.1080p.BluRay.x265-SPARKS",
		);
		expect(decision).toBe(env.Decision.NO_DOWNLOAD_LINK);
	});

	it("still rejects different trailing release groups", async () => {
		const decision = await decide(
			"My.Movie.2019.1080p.BluRay.x264-SPARKS",
			"My.Movie.2019.1080p.BluRay.x264-WiKi",
		);
		expect(decision).toBe(env.Decision.RELEASE_GROUP_MISMATCH);
	});

	it("passes when a name has no release group", async () => {
		const decision = await decide(
			"My.Movie.2019.1080p.BluRay",
			"My.Movie.2019.1080p.BluRay-SPARKS",
		);
		expect(decision).toBe(env.Decision.NO_DOWNLOAD_LINK);
	});
});
