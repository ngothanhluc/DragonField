using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;
public class LevelMove_Village : MonoBehaviour
{
    public LevelMenu levelMenu;

    private void OnTriggerEnter2D(Collider2D collision)
    {
        if (collision.CompareTag("Player"))
        {
            if (levelMenu != null)
                levelMenu.OpenLevelMenu();
        }
    }
}
