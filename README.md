# snatcher 🚀

A CLI tool to **snatch** the **main** sourcemap from your production React (or similar Webpack-based) app and reconstruct your **actual** code. No more rummaging through node\_modules or weird bundler files — just the good stuff (like your `src/App.js`)!

When `snatcher` runs, it:

1. Fetches the **main HTML** from your site.
2. Locates the **first script** whose path includes `"main"`.
3. Extracts the `//# sourceMappingURL=...` comment from that script.
4. Downloads the `.map` file and **rebuilds** the source files it contains — **skipping** anything that has `node_modules/` or `webpack/` in the path.
5. Creates a **snatch-report.json** in your output folder with metadata about what it did and a list of any `node_modules` packages it sees (but doesn’t download).

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Example](#example)
- [JSON Report](#json-report)
- [Skipping Node Modules](#skipping-node-modules)
- [Limitations & Warnings](#limitations--warnings)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Automagic Discovery**: No need to guess your hashed filenames. `snatcher` sees whatever the HTML references for your “main” script.
- **Selective Recovery**: It **omits** all the `node_modules` or `webpack`-related stuff in the sourcemap, focusing on your own code.
- **Image Stub Replacement**: Spots lines like `__webpack_public_path__ + "static/media/Logo.123abc.png"` and fetches the **real** image file for you.
- **JSON Reporting**: You get a `snatch-report.json` summarizing the job, listing packages that might be in your `node_modules`, etc.

---

## Installation

```bash
npm install -g snatcher
```

This installs the CLI command `snatcher` globally so you can run it anywhere.\
*(Or use **`npx`** if you prefer not to install globally.)*

---

## Usage

```bash
snatcher <baseUrl> [options]
```

where:

- The **public URL** of your site. For instance, `https://myusername.github.io/my-react-app/` or `https://example.com/subfolder/`.
- `` (default: `recovered-files`): The folder where snatched files go.
- Prints out extra logs about what it’s doing.

---

## Example

Suppose your site is at `https://myusername.github.io/my-react-app/`. Run:

```bash
snatcher https://myusername.github.io/my-react-app/ -o recovered-code
```

**What happens**:

1. `snatcher` fetches your main page’s HTML.
2. Finds the first `<script>` whose `src` includes `"main"`.
3. Looks for `//# sourceMappingURL=main.abc123.js.map`.
4. Downloads & parses that `.map`.
5. Writes every relevant file under `recovered-code/`, except those containing `node_modules/` or `webpack/` in their path.
6. Creates `recovered-code/snatch-report.json` with stats & possible package names.

---

## JSON Report

After each run, you’ll see a `` in the output folder, containing:

- The site you scanned (e.g. `"https://myusername.github.io/my-react-app/"`).
- The actual `.map` URL discovered (e.g. `"https://.../main.abc123.js.map"`).
- When the snatching happened.
- How many sources the sourcemap contained.
- How many sources were written to disk (i.e. your custom code).
- How many sources were ignored (e.g. node\_modules).
- A list of package names gleaned from any references that contained `node_modules/<packageName>` in their path.

It might look something like:

```json
{
  "baseUrl": "https://myusername.github.io/my-react-app/",
  "mapUrl": "https://myusername.github.io/my-react-app/static/js/main.abc123.js.map",
  "timestamp": "2025-02-01T12:34:56.789Z",
  "totalSources": 40,
  "writtenSources": 10,
  "skippedSources": 30,
  "possibleNodePackages": ["react", "react-dom", "scheduler"]
}
```

---

## Skipping Node Modules

By default, `snatcher` checks if a file path includes `node_modules/` or `webpack/`. If so, it **skips** writing that file to your local system. Instead, it just **logs** the package name in the report.

Why? Because you probably don’t need the entire `node_modules` tree — just your own actual code. This also helps avoid pulling in thousands of files.

---

## Limitations & Warnings

1. **“Main” Only**: We only look for the first script containing `main`. If your app splits into multiple chunks or code-splits everything, those might not be recovered.
2. **Must Actually Deploy **``: If your production build is configured to disable or remove `.map` files, `snatcher` can’t snatch anything.
3. **Embedded **`` Required: We rely on the `.map` having real code in `sourcesContent`. If it’s referencing external files that aren’t included, you’ll get partial or no code.
4. **Use on Your Own Code**: This is meant for **your** code or code you have explicit rights to. Respect others’ IP.
5. **Naive Filter**: If you need stricter or different filtering (e.g., only `src/` files, or ignoring tests), adapt it in the script.

---

## Contributing

Contributions welcome! To get started:

1. **Fork** this repository.
2. **Create** a new branch with your feature or fix.
3. **Open a Pull Request** describing your changes.

We appreciate bug reports, feature requests, and code improvements.

---

## License

**MIT License**\
Feel free to use, modify, and distribute. See [LICENSE](LICENSE) for the full text.

---

**Happy Snatching!** 🦅
