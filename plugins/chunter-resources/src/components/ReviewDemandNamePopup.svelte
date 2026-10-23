<script lang="ts">
  import { createEventDispatcher, onMount } from 'svelte'
  import { Button } from '@hcengineering/ui'

  const dispatch = createEventDispatcher()
  let title = ''
  let input: HTMLInputElement

  onMount(() => input.focus())

  function confirm (): void {
    const value = title.trim()
    if (value.length > 0) dispatch('close', value)
  }
</script>

<form class="selectPopup review-demand-name" on:submit|preventDefault={confirm}>
  <h3>创建需求</h3>
  <label for="review-demand-name">需求名称</label>
  <input id="review-demand-name" bind:this={input} bind:value={title} maxlength="100" autocomplete="off" />
  <p>本条消息和附件将归入这个需求。</p>
  <div class="actions">
    <Button on:click={() => dispatch('close')}><span slot="content">取消</span></Button>
    <Button kind="primary" disabled={title.trim().length === 0} on:click={confirm}>
      <span slot="content">创建并发送</span>
    </Button>
  </div>
</form>

<style>
  .review-demand-name { padding: 1.25rem; width: min(22rem, 85vw); }
  h3 { margin: 0 0 1rem; }
  label { display: block; margin-bottom: 0.5rem; }
  input { width: 100%; padding: 0.5rem; color: var(--global-primary-TextColor); background: var(--global-ui-BackgroundColor); border: 1px solid var(--global-ui-BorderColor); border-radius: 0.25rem; }
  p { margin: 0.75rem 0; }
  .actions { display: flex; justify-content: flex-end; gap: 0.5rem; }
</style>
