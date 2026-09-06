import { Composition, Still } from "remotion";
import { Walkthrough, Thumbnail, FULL_SCENES, SHORT_SCENES, totalFrames } from "./Walkthrough";

export const FPS = 30;

export const Root = () => (
  <>
    <Composition id="Walkthrough" component={Walkthrough} durationInFrames={totalFrames(FULL_SCENES)} fps={FPS} width={1920} height={1080} defaultProps={{ scenes: FULL_SCENES }} />
    <Composition id="Short45" component={Walkthrough} durationInFrames={totalFrames(SHORT_SCENES)} fps={FPS} width={1920} height={1080} defaultProps={{ scenes: SHORT_SCENES }} />
    <Still id="Thumbnail" component={Thumbnail} width={1920} height={1080} />
  </>
);
