// Tags are also the package versions. Preview packages are not published to npm.
export function releaseVersion(tag) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-preview\.(0|[1-9]\d*))?$/.test(tag)) {
    throw new Error('Release tags must use major.minor.patch or major.minor.patch-preview.N');
  }
  return {version: tag, prerelease: tag.includes('-')};
}
