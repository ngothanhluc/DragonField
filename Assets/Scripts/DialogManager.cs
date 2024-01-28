using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class DialogManager : MonoBehaviour
{
    [SerializeField]
    private GameObject dialogBox;
    [SerializeField]
    private TMPro.TextMeshProUGUI dialogText;
    [SerializeField]
    private int lettersPerSecond;
    public static DialogManager Instance { get; private set; }
    private void Awake()
    {
        Instance = this;
    }

    public void ShowDialog(Dialog dialog, int index)
    {
        dialogBox.SetActive(true);
        StartCoroutine(TypeDialog(dialog.Lines[index]));
    }
    public IEnumerator TypeDialog(string line)
    {
        dialogText.text = "";
        string dialog = "";
        for (int i = 0; i < line.Length; i++)
        {
            dialog += line[i];
            dialogText.SetText(dialog);
            yield return new WaitForSeconds(1f / lettersPerSecond);
        }
        // yield return new WaitForSeconds(1f);

        // dialogBox.SetActive(false);
    }
    public void CloseDialog()
    {
        dialogBox.SetActive(false);
    }
}
