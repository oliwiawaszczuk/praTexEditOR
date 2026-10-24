<script lang="ts">
  // "Projekt" tab: start screen, or the open project rebuilt per project ({#key}).
  import { currentProject } from "#lib/core/projects.svelte.ts";
  import StartScreen from "#lib/start/StartScreen.svelte";
  import Workspace from "./Workspace.svelte";

  const p = $derived(currentProject());
</script>

{#if p}
  {#key p.id}
    <Workspace />
  {/key}
{:else}
  <StartScreen />
{/if}
