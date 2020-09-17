# Prateek Codes Blog

[Live Demo](https://prateekcodes.dev/)

### Setup
```
$ brew install gsl # macOS
OR
$ sudo apt-get install libgsl-dev # debian
$ bundle
```

### Running the app

```
$ jekyll serve --watch
```
Navigate to `localhost:4000` in your browser.

```
# starts with rack. Loads config.ru. You can test redirection etc.
# In this mode by default all http urls will be redirected to https. Use ngrok if you don't have local certificates
# Setup
$ foreman start
```