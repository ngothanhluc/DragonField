using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class NPCController : MonoBehaviour
{
    [SerializeField]
    Dialog dialog;
    public bool playerIsClose;
    private int index = 0;
    public GameObject contButton;
    public void Interact()
    {
        if (playerIsClose)
        {
            DialogManager.Instance.ShowDialog(dialog, index);
        }
    }
    public void NextLine()
    {
        Debug.Log("NextLine");
        if (!playerIsClose)
            return;
        index++;
        if (index < dialog.Lines.Count)
        {
            DialogManager.Instance.ShowDialog(dialog, index);
        }
        else
        {
            index = 0;
            DialogManager.Instance.CloseDialog();
        }
    }
    private void OnTriggerEnter2D(Collider2D other)
    {
        if (other.CompareTag("Player"))
        {
            playerIsClose = true;
        }
    }
    private void OnTriggerExit2D(Collider2D other)
    {
        if (other.CompareTag("Player"))
        {
            playerIsClose = false;
            DialogManager.Instance.CloseDialog();
        }
    }
}
