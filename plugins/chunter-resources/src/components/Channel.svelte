<!--
// Copyright © 2023 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
-->
<script lang="ts">
  import { Doc, getCurrentAccount, Ref, SortingOrder } from '@hcengineering/core'
  import type { ChatMessage } from '@hcengineering/chunter'
  import notification, { DocNotifyContext } from '@hcengineering/notification'
  import activity, { ActivityMessage, WithReferences } from '@hcengineering/activity'
  import { createQuery, getClient, isSpace } from '@hcengineering/presentation'
  import { getMessageFromLoc, messageInFocus } from '@hcengineering/activity-resources'
  import { location as locationStore } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'

  import chunter from '../plugin'
  import { ChannelDataProvider } from '../channelDataProvider'
  import ReverseChannelScrollView from './ReverseChannelScrollView.svelte'
  import {
    clearReviewDemand,
    reviewDemandStore,
    setReviewDemand
  } from '../reviewDemand'

  export let object: Doc
  export let context: DocNotifyContext | undefined = undefined
  export let syncLocation = true
  export let autofocus = true
  export let freeze = false
  export let readonly = false
  export let selectedMessageId: Ref<ActivityMessage> | undefined = undefined
  export let collection: string | undefined = undefined
  export let withInput: boolean = true
  export let onReply: ((message: ActivityMessage) => void) | undefined = undefined

  const client = getClient()
  const hierarchy = client.getHierarchy()

  let dataProvider: ChannelDataProvider | undefined
  let demands: ChatMessage[] = []
  const demandQuery = createQuery()
  const demandContextStore = reviewDemandStore(object._id)

  function handleDemandChange (event: Event): void {
    const rootId = (event.currentTarget as HTMLSelectElement).value
    const root = demands.find((item) => item._id === rootId)
    if (root?.reviewDemandTitle !== undefined) {
      setReviewDemand({ channelId: object._id, rootId: root._id, title: root.reviewDemandTitle })
    }
  }

  const unsubscribe = messageInFocus.subscribe((id) => {
    if (!syncLocation) return
    if (id !== undefined && id !== selectedMessageId) {
      selectedMessageId = id
    }

    messageInFocus.set(undefined)
  })

  const unsubscribeLocation = locationStore.subscribe((newLocation) => {
    if (!syncLocation) return
    const id = getMessageFromLoc(newLocation)
    selectedMessageId = id
    messageInFocus.set(id)
  })

  onDestroy(() => {
    unsubscribe()
    unsubscribeLocation()
    dataProvider?.destroy()
    dataProvider = undefined
    demandQuery.unsubscribe()
  })

  let refsLoaded = false
  let demandIsValid = true

  $: isDocChannel = !hierarchy.isDerived(object._class, chunter.class.ChunterSpace)
  $: demandIsValid = $demandContextStore === undefined || demands.some((demand) => demand._id === $demandContextStore?.rootId)

  $: demandQuery.query(
    chunter.class.ChatMessage,
    { attachedTo: object._id, space: isSpace(object) ? object._id : object.space },
    (result: ChatMessage[]) => {
      demands = result.filter((message) => message.reviewDemandTitle !== undefined)
      dataProvider?.setDemandRoots(demands.map((message) => message._id))
    },
    { sort: { createdOn: SortingOrder.Ascending } }
  )

  $: void updateDataProvider(object._id, selectedMessageId)

  async function updateDataProvider (attachedTo: Ref<Doc>, selectedMessageId?: Ref<ActivityMessage>): Promise<void> {
    if (dataProvider === undefined) {
      const ctx =
        context ??
        (await client.findOne(notification.class.DocNotifyContext, {
          objectId: object._id,
          user: getCurrentAccount().uuid
        }))
      const hasRefs = ((object as WithReferences<Doc>).references ?? 0) > 0
      refsLoaded = hasRefs
      const space = isSpace(object) ? object._id : object.space
      dataProvider = new ChannelDataProvider(
        ctx,
        space,
        attachedTo,
        activity.class.ActivityMessage,
        selectedMessageId,
        false,
        hasRefs,
        collection
      )
      dataProvider.setDemandRoots(demands.map((message) => message._id))
    }
  }

  $: if (dataProvider && !refsLoaded && ((object as WithReferences<Doc>).references ?? 0) > 0) {
    dataProvider.loadRefs()
    refsLoaded = true
  }
</script>

{#if dataProvider}
  <ReverseChannelScrollView
    channel={object}
    bind:selectedMessageId
    {object}
    collection={collection ?? (isDocChannel ? 'comments' : 'messages')}
    provider={dataProvider}
    {freeze}
    {autofocus}
    loadMoreAllowed
    {withInput}
    {readonly}
    {onReply}
    reviewDemandRootId={demandIsValid ? $demandContextStore?.rootId : undefined}
    reviewDemandTitle={demandIsValid ? $demandContextStore?.title : undefined}
    reviewDemandInvalid={!demandIsValid}
    reviewDemandTitles={Object.fromEntries(demands.map((demand) => [demand._id, demand.reviewDemandTitle]))}
  >
    <svelte:fragment slot="composerHeader">
      <div class="review-demand-bar">
        {#if $demandContextStore && !demandIsValid}
          <strong>当前需求已失效，请退出后重新选择</strong>
          <button type="button" on:click={() => clearReviewDemand(object._id)}>退出需求</button>
        {:else if $demandContextStore}
          <strong>当前需求：{$demandContextStore.title}</strong>
          <button type="button" on:click={() => clearReviewDemand(object._id)}>退出需求</button>
        {:else}
          <span>当前需求：未选择，发送到频道普通聊天</span>
        {/if}
        <label>
          <span class="sr-only">选择需求</span>
          <select
            aria-label="选择需求"
            value={$demandContextStore?.rootId ?? ''}
            on:change={handleDemandChange}
          >
            <option value="">选择需求</option>
            {#each demands as demand}
              <option value={demand._id}>{demand.reviewDemandTitle}</option>
            {/each}
          </select>
        </label>
      </div>
    </svelte:fragment>
  </ReverseChannelScrollView>
{/if}

<style>
  .review-demand-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.25rem;
    padding: 0.35rem 1rem;
    border-bottom: 1px solid var(--global-ui-BorderColor);
    color: var(--global-primary-TextColor);
  }

  .review-demand-bar button {
    border: 0;
    background: transparent;
    color: var(--global-primary-Color);
    cursor: pointer;
  }

  .review-demand-bar select {
    max-width: 14rem;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
  }
</style>
