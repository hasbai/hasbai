<script lang="ts">
 import { Spinner } from "@hasbai/ui/progress";
  import * as Dialog from "@hasbai/ui/dialog";
  import { Button } from "@hasbai/ui/button";
  let {
    open = $bindable(false),
    title,
    busy = false,
    onconfirm,
  }: {
    open?: boolean;
    title: string;
    busy?: boolean;
    onconfirm: () => void;
  } = $props();
</script>

<Dialog.Root bind:open
  ><Dialog.Content
    showCloseButton={!busy}
    onInteractOutside={(e) => {
      if (busy) e.preventDefault();
    }}
    onEscapeKeydown={(e) => {
      if (busy) e.preventDefault();
    }}
    ><Dialog.Header><Dialog.Title>{title}</Dialog.Title></Dialog.Header
    ><Dialog.Footer
      ><Button variant="outline" disabled={busy} onclick={() => (open = false)}
        >取消</Button
      ><Button variant="destructive" disabled={busy} onclick={onconfirm}
        >{#if busy}<Spinner/>{/if}确认</Button
      ></Dialog.Footer
    ></Dialog.Content
  ></Dialog.Root
>
