# Commentary Review SDK

Browser SDK for Commentary Live Preview Reviews.

The SDK lets a preview app connect to Commentary, expose route changes, and let reviewers select UI elements for anchored comments. It is designed to run only in review or preview environments.

## Install

```sh
npm install @commentary-dev/review-sdk
```

For CDN usage, load the browser bundle:

```html
<script src="https://cdn.commentary.dev/review-sdk/latest/commentary-review-sdk.js"></script>
```

## Usage

The browser bundle initializes itself when loaded. Configure the parent origin before the script when your review shell does not run at the default Commentary origin:

```html
<script>
  window.__COMMENTARY_PARENT_ORIGIN__ = "https://commentary.dev";
  window.__COMMENTARY_BUILD_ID__ = "preview-123";
  window.__COMMENTARY_COMMIT_SHA__ = "abcdef123456";
</script>
<script src="https://cdn.commentary.dev/review-sdk/latest/commentary-review-sdk.js"></script>
```

Use stable element attributes for the best anchors:

```html
<button data-commentary-id="Billing.save">Save changes</button>
```

## Package Outputs

- `dist/commentary-review-sdk.js`: self-initializing browser SDK.
- `dist/index.d.ts`: ambient browser configuration declarations.

## Release

This package is published as `@commentary-dev/review-sdk` and mirrored to `https://cdn.commentary.dev/review-sdk/`.
