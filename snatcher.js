#!/usr/bin/env node

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { SourceMapConsumer } = require('source-map');
const { URL } = require('url');

/** Simple debug logger */
function debugLog(debug, ...args) {
	if (debug) {
		console.log('[DEBUG]', ...args);
	}
}

/**
 * Fetch the HTML at baseUrl, parse out <script src="...">,
 * return the first one that has "main" in its path.
 */
async function findMainScript(baseUrl, debug) {
	debugLog(debug, 'Fetching HTML from:', baseUrl);
	try {
		const res = await axios.get(baseUrl, { validateStatus: () => true });
		debugLog(debug, 'Response code for HTML =>', res.status);

		if (res.status !== 200) {
			console.log(`Failed to fetch HTML from ${baseUrl} (HTTP ${res.status})`);
			return null;
		}

		const html = res.data;
		const scriptTagRegex = /<script[^>]+src=["']([^"']+)["']/gi;

		let mainScriptUrl = null;
		let match;
		while ((match = scriptTagRegex.exec(html)) !== null) {
			const scriptPath = match[1];
			debugLog(debug, 'Found script path:', scriptPath);

			if (scriptPath.includes('main')) {
				// Resolve to absolute URL
				const absUrl = new URL(scriptPath, baseUrl).toString();
				debugLog(debug, 'Resolved main script URL =>', absUrl);
				mainScriptUrl = absUrl;
				break; // only the first "main" script
			}
		}
		return mainScriptUrl;
	} catch (err) {
		console.log(`Error fetching HTML => ${err.message}`);
		return null;
	}
}

/**
 * Extract //# sourceMappingURL=... from a JS file.
 */
async function getMapUrlFromJs(jsUrl, debug) {
	debugLog(debug, `Downloading JS file => ${jsUrl}`);
	try {
		const { data: jsContent } = await axios.get(jsUrl, { validateStatus: () => true });
		if (typeof jsContent !== 'string') {
			debugLog(debug, `No/invalid JS content => ${jsUrl}`);
			return null;
		}

		const regex = /\/\/# sourceMappingURL=(.*)$/m;
		const match = jsContent.match(regex);
		if (!match) {
			debugLog(debug, `No sourceMappingURL found => ${jsUrl}`);
			return null;
		}

		const mapRelative = match[1].trim();
		if (!mapRelative) return null;

		const mapAbsUrl = new URL(mapRelative, jsUrl).toString();
		debugLog(debug, `Constructed map URL => ${mapAbsUrl}`);
		return mapAbsUrl;
	} catch (err) {
		console.error(`Error fetching JS => ${err.message}`);
		return null;
	}
}

/**
 * Core logic to parse the .map and selectively write files:
 * 1) Skip anything referencing node_modules or webpack in path
 * 2) Write everything else to disk
 * 3) Collect possible package names from node_modules references
 * 4) Create a JSON report in the output folder with metadata
 */
async function restoreFromMap(mapUrl, baseUrl, outputDir, debug) {
	console.log(`\nSnatching sourcemap from: ${mapUrl}`);

	// Prepare a data structure for our report
	const report = {
		baseUrl,
		mapUrl,
		timestamp: new Date().toISOString(),
		totalSources: 0,
		writtenSources: 0,
		skippedSources: 0,
		possibleNodePackages: [], // We'll populate from node_modules references
	};

	// Use a set to avoid duplicates for possible packages
	const packageSet = new Set();

	try {
		const { data: mapData } = await axios.get(mapUrl);
		const consumer = await new SourceMapConsumer(mapData);

		fs.mkdirSync(outputDir, { recursive: true });

		const allSources = consumer.sources;
		report.totalSources = allSources.length;

		console.log(`Discovered ${allSources.length} sources in the map.\n`);

		for (const source of allSources) {
			const sourceCode = consumer.sourceContentFor(source, true);
			if (!sourceCode) {
				console.warn(`No content for source: ${source}`);
				continue;
			}

			// Decide if we skip or write
			// Example condition: skip anything with 'node_modules/' or 'webpack/' in the path
			// You could also do: if (!source.startsWith('src/')) skip it, for a stricter rule.
			const lower = source.toLowerCase();
			const skipIt = lower.includes('node_modules/') || lower.includes('webpack/');
			if (skipIt) {
				report.skippedSources++;
				// Attempt to parse out node_modules/<packageName> to store in packageSet
				const pkgMatch = source.match(/node_modules\/([^/]+)\//);
				if (pkgMatch) {
					packageSet.add(pkgMatch[1]);
				}
				// Do not write the file
				continue;
			}

			// Otherwise, we write the file
			const localPath = path.join(outputDir, source);
			fs.mkdirSync(path.dirname(localPath), { recursive: true });

			// If it's an image stub => we attempt to fetch the real image
			if (/\.(png|jpe?g|gif|svg|webp|bmp)$/i.test(source)) {
				const match = sourceCode.match(/__webpack_public_path__ \+ "([^"]+)"/);
				if (match) {
					const hashedPath = match[1];
					const imageUrl = new URL(hashedPath, baseUrl).toString();
					console.log(`Detected stub for image: ${source}`);
					console.log(`Downloading real image from: ${imageUrl}`);
					try {
						const resp = await axios.get(imageUrl, { responseType: 'arraybuffer' });
						fs.writeFileSync(localPath, resp.data);
						console.log(`Saved real image to: ${localPath}`);
					} catch (err) {
						console.error(`Failed to fetch image => ${err.message}`);
						fs.writeFileSync(localPath, sourceCode, 'utf8');
					}
				} else {
					fs.writeFileSync(localPath, sourceCode, 'utf8');
				}
			} else {
				// Typically JS, TS, CSS, etc.
				fs.writeFileSync(localPath, sourceCode, 'utf8');
				console.log(`Wrote file: ${localPath}`);
			}

			report.writtenSources++;
		}

		consumer.destroy();

		// Finalize the package array
		report.possibleNodePackages = Array.from(packageSet);

		// Write the JSON report
		const reportPath = path.join(outputDir, 'snatch-report.json');
		fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
		console.log(`\nCreated JSON report => ${reportPath}`);

		console.log(`\nSkipped ${report.skippedSources} sources, wrote ${report.writtenSources}, out of ${report.totalSources} total.`);
		console.log(`Possible node packages: [${report.possibleNodePackages.join(', ')}]`);

		console.log(`\nDone snatching from: ${mapUrl}\n`);
	} catch (err) {
		console.error(`Error restoring from map => ${err.message}`);
	}
}

/** Main flow: find the main script, parse its map, restore. */
async function main(baseUrl, outputDir, debug) {
	console.log(`Snatcher scanning HTML at: ${baseUrl}`);

	const mainScriptUrl = await findMainScript(baseUrl, debug);
	if (!mainScriptUrl) {
		console.log('No main script found in the HTML. Exiting.');
		return;
	}

	const mapUrl = await getMapUrlFromJs(mainScriptUrl, debug);
	if (!mapUrl) {
		console.log(`No sourceMappingURL found in: ${mainScriptUrl}`);
		return;
	}

	// Verify the map
	try {
		const headRes = await axios.head(mapUrl, { validateStatus: () => true });
		if (headRes.status !== 200) {
			console.log(`Map not found (HTTP ${headRes.status}) => ${mapUrl}`);
			return;
		}
	} catch (err) {
		console.log(`Error verifying map => ${mapUrl}: ${err.message}`);
		return;
	}

	await restoreFromMap(mapUrl, baseUrl, outputDir, debug);
	console.log('Snatcher is done!');
}

// Commander CLI
program
	.name('snatcher')
	.description(`
"snatcher" is a CLI tool that locates the main JS bundle in a production React/CRA site,
grabs the sourcemap, and reconstructs only the top-level source files (omitting node_modules, webpack, etc.).
It then creates a JSON report with metadata and potential package names.
`)
	.argument('<baseUrl>', 'Base URL of the site to scan (e.g. https://example.com/ or https://user.github.io/app/)')
	.option('-o, --output <dir>', 'Output directory (default: recovered-files)', 'recovered-files')
	.option('-d, --debug', 'Enable debug logging', false)
	.action(async (baseUrl, options) => {
		await main(baseUrl, options.output, options.debug);
	});

program.parse(process.argv);
