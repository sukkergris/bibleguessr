# Display the Application Version

Add a hardcoded version number to both the frontend and backend.

## Backend

Add an API endpoint that returns the hardcoded backend version number. The endpoint should return a simple, documented response, such as:

```json
{ "version": "1.0.0" }
```

## Frontend

Add the hardcoded frontend version number to `frontend/index.html` using a `<meta>` tag, for example:

```html
<meta name="application-version" content="1.0.0" />
```

The frontend and backend versions may be different and should be easy to find when diagnosing or reporting problems.

## Nerd Tab

Display both the frontend and backend version numbers in the Nerd tab. Label each version clearly so users can identify which version is running when reporting a problem.
